'use strict';

const crypto = require('crypto');
const cron = require('node-cron');
const db = require('../db');
const JevClient = require('./jevClient');

const SCORE_CRITERIA = Object.freeze([
    'Low operational urgency: keep this below otherwise similar local candidates.',
    'Normal urgency: retain the local formula ranking.',
    'High operational urgency: prioritize this among otherwise similar local candidates.',
]);
const SCORE_PROMPT_VERSION = 'inventory-urgency-v1';

const scoreThreshold = (value, fallback = 0.80) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.5, Math.min(number, 0.99)) : fallback;
};

class JevInventoryScoringService {
    constructor({ database = db, client = new JevClient(), env = process.env, logger = console } = {}) {
        this.db = database;
        this.client = client;
        this.env = env;
        this.logger = logger;
    }

    get maxCandidates() {
        const value = Number(this.env.JEV_INVENTORY_SCORE_MAX_CANDIDATES || 50);
        return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 200)) : 50;
    }

    get cacheHours() {
        const value = Number(this.env.JEV_INVENTORY_SCORE_CACHE_HOURS || 168);
        return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 24 * 365)) : 168;
    }

    async refresh() {
        if (!this.client.isConfigured()) return { cycleCount: 0, reorder: 0, skipped: true };
        const [cycleRows, reorderRows] = await Promise.all([
            this.loadCycleCountCandidates(), this.loadReorderCandidates(),
        ]);
        const [cycleCount, reorder] = await Promise.all([
            this.scoreRows('cycle_count', cycleRows), this.scoreRows('reorder', reorderRows),
        ]);
        return { cycleCount, reorder, skipped: false };
    }

    async loadCycleCountCandidates() {
        const { rows } = await this.db.query(`
            SELECT p.part_id, p.display_name, p.detail, p.wac_cost, p.last_cost,
                   COALESCE(pis.last_counted_at, p.date_created) AS last_counted_at,
                   COALESCE(pis.audit_requested, FALSE) AS audit_requested,
                   COALESCE((SELECT SUM(quantity) FROM inventory_transaction WHERE part_id = p.part_id), 0) AS stock_on_hand,
                   COALESCE((SELECT SUM(ABS(quantity)) FROM inventory_transaction
                     WHERE part_id = p.part_id AND trans_type = 'StockOut'
                       AND transaction_date >= NOW() - INTERVAL '30 days'), 0) AS velocity_30d
            FROM part p LEFT JOIN part_inventory_stats pis ON pis.part_id = p.part_id
            WHERE p.is_active = TRUE
            ORDER BY COALESCE(pis.audit_requested, FALSE) DESC,
                     COALESCE((SELECT SUM(ABS(quantity)) FROM inventory_transaction
                       WHERE part_id = p.part_id AND trans_type = 'StockOut'
                         AND transaction_date >= NOW() - INTERVAL '30 days'), 0) DESC,
                     COALESCE(p.wac_cost, p.last_cost, 0) DESC
            LIMIT $1`, [this.maxCandidates]);
        return rows;
    }

    async loadReorderCandidates() {
        const { rows } = await this.db.query(`
            SELECT p.part_id, p.display_name, p.detail, p.wac_cost, p.last_cost,
                   COALESCE((SELECT SUM(it.quantity) FROM inventory_transaction it WHERE it.part_id = p.part_id), 0) AS stock_on_hand,
                   COALESCE(SUM(il.quantity), 0) AS demand_90d,
                   COUNT(DISTINCT il.invoice_id) AS orders_90d
            FROM part p
            JOIN invoice_line il ON il.part_id = p.part_id
            JOIN invoice i ON i.invoice_id = il.invoice_id AND i.status <> 'Cancelled'
            WHERE p.is_active = TRUE AND p.is_service = FALSE AND p.merged_into_part_id IS NULL
              AND (i.invoice_date AT TIME ZONE 'Asia/Manila')::date > CURRENT_DATE - INTERVAL '90 days'
            GROUP BY p.part_id
            HAVING COUNT(DISTINCT il.invoice_id) >= 3
               AND (COALESCE((SELECT SUM(it.quantity) FROM inventory_transaction it WHERE it.part_id = p.part_id), 0) <= 0
                 OR COALESCE((SELECT SUM(it.quantity) FROM inventory_transaction it WHERE it.part_id = p.part_id), 0) < (SUM(il.quantity) / 90.0) * 30)
            ORDER BY SUM(il.quantity) DESC
            LIMIT $1`, [this.maxCandidates]);
        return rows;
    }

    async scoreRows(scoreType, rows) {
        const threshold = scoreThreshold(this.env.JEV_INVENTORY_SCORE_CONFIDENCE);
        let written = 0;
        for (const row of rows) {
            // Explicit operator audit requests and negative stock are hard local
            // overrides; Jev must never dilute either signal.
            if (scoreType === 'cycle_count' && (row.audit_requested || Number(row.stock_on_hand) < 0)) continue;
            try {
                const fingerprint = this.buildFingerprint(scoreType, row);
                if (await this.hasFreshScore(scoreType, row.part_id, fingerprint)) continue;
                const decision = await this.client.evaluateScore({
                    question: `${scoreType}_urgency`,
                    state: { recommendation_type: scoreType, part: row },
                    instructions: 'Assess only nuanced operational urgency using the supplied local facts. Do not invent demand, stock, or supplier facts; the deterministic local formula remains authoritative.',
                    criteria: SCORE_CRITERIA,
                });
                if (!decision || decision.confidence < threshold) continue;
                await this.db.query(`
                    INSERT INTO public.jev_inventory_score
                        (part_id, score_type, score, confidence, model, input_fingerprint, factors, evaluated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
                    ON CONFLICT (part_id, score_type) DO UPDATE SET
                        score = EXCLUDED.score, confidence = EXCLUDED.confidence,
                        model = EXCLUDED.model, input_fingerprint = EXCLUDED.input_fingerprint,
                        factors = EXCLUDED.factors, evaluated_at = NOW()
                `, [row.part_id, scoreType, Math.round(decision.score), decision.confidence, decision.model, fingerprint, JSON.stringify(row)]);
                written++;
            } catch (error) {
                this.logger.warn(`[JevInventoryScoring] ${scoreType} score unavailable for part ${row.part_id}:`, error.message);
            }
        }
        return written;
    }

    buildFingerprint(scoreType, row) {
        // Include the configured model and prompt version in the input identity:
        // changing either deliberately causes a one-time re-evaluation.
        const stableRow = Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)));
        return crypto.createHash('sha256').update(JSON.stringify({
            scoreType, row: stableRow, model: this.client.config?.model || 'configured-model', promptVersion: SCORE_PROMPT_VERSION,
        })).digest('hex');
    }

    async hasFreshScore(scoreType, partId, fingerprint) {
        const { rows } = await this.db.query(`
            SELECT 1 FROM public.jev_inventory_score
            WHERE part_id = $1 AND score_type = $2 AND input_fingerprint = $3
              AND evaluated_at >= NOW() - make_interval(hours => $4)
            LIMIT 1
        `, [partId, scoreType, fingerprint, this.cacheHours]);
        return Boolean(rows[0]);
    }
}

let currentCronJob = null;
function startJevInventoryScoringEngine() {
    const service = new JevInventoryScoringService();
    if (!service.client.isConfigured()) return;
    const schedule = service.env.JEV_INVENTORY_SCORE_SCHEDULE || '30 1 * * *';
    if (currentCronJob) currentCronJob.stop();
    currentCronJob = cron.schedule(schedule, () => {
        service.refresh().then((result) => service.logger.log('[JevInventoryScoring] Refresh complete:', result))
            .catch((error) => service.logger.error('[JevInventoryScoring] Refresh failed:', error));
    });
    service.logger.log(`[JevInventoryScoring] Scheduled nightly refresh: ${schedule}`);
}

module.exports = { JevInventoryScoringService, startJevInventoryScoringEngine, SCORE_CRITERIA };
