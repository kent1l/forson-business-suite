const JevClient = require('./jevClient');
const MasterDataMergeService = require('./masterDataMergeService');
const MERGE_POLICY = require('./masterDataMergePolicy');

const PARTIES = {
    customer: {
        table: 'customer', id: 'customer_id', code: 'customer_code', mergedInto: 'merged_into_customer_id',
        suggestion: 'customer_duplicate_suggestion', permission: 'customers:edit',
        name: "COALESCE(NULLIF(c.company_name, ''), NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.customer_code)",
        duplicateName: "COALESCE(NULLIF(d.company_name, ''), NULLIF(BTRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''), d.customer_code)",
    },
    supplier: {
        table: 'supplier', id: 'supplier_id', code: 'supplier_code', mergedInto: 'merged_into_supplier_id',
        suggestion: 'supplier_duplicate_suggestion', permission: 'suppliers:edit',
        name: 'c.supplier_name', duplicateName: 'd.supplier_name',
    },
};

class PartyMergeService {
    constructor(db, party, { jevClient = new JevClient() } = {}) {
        this.db = db;
        this.party = PARTIES[party];
        this.jevClient = jevClient;
        if (!this.party) throw new Error(`Unsupported merge party: ${party}`);
    }

    async list() {
        const p = this.party;
        const usage = MERGE_POLICY[p.table].references.filter(([, , action]) => action !== 'provenance' && action !== 'workflow').map(([table, column]) => `(SELECT COUNT(*) FROM ${table} r WHERE r.${column} = c.${p.id})`).join(' + ');
        const { rows } = await this.db.query(`SELECT c.*, ${p.name} AS display_name, (${usage})::int AS reference_count FROM ${p.table} c WHERE NOT c.is_merged AND c.is_active ORDER BY display_name`);
        return rows;
    }

    async scan({ threshold = 0.55, jevThreshold = Number(process.env.JEV_DUPLICATE_THRESHOLD || 0.8) } = {}) {
        const p = this.party;
        const minimum = Math.max(0.1, Math.min(0.99, Number(threshold) || 0.55));
        const minimumJev = Math.max(0.5, Math.min(0.99, Number(jevThreshold) || 0.8));
        const client = await this.db.getClient();
        try {
            const { rows: pairs } = await client.query(`
                SELECT c.${p.id} AS entity_id, d.${p.id} AS duplicate_entity_id,
                       similarity(LOWER(${p.name}), LOWER(${p.duplicateName})) AS score,
                       CASE WHEN regexp_replace(LOWER(${p.name}), '[^a-z0-9]+', '', 'g') = regexp_replace(LOWER(${p.duplicateName}), '[^a-z0-9]+', '', 'g') THEN 'normalized_name' ELSE 'pg_trgm' END AS method,
                       ${p.name} AS entity_name, c.${p.code} AS entity_code, ${p.duplicateName} AS duplicate_entity_name, d.${p.code} AS duplicate_entity_code
                FROM ${p.table} c JOIN ${p.table} d ON c.${p.id} < d.${p.id}
                WHERE NOT c.is_merged AND NOT d.is_merged AND similarity(LOWER(${p.name}), LOWER(${p.duplicateName})) >= $1`, [minimum]);
            const enabled = this.jevClient.isConfigured();
            let evaluated = 0, rejected = 0, failures = 0;
            const suggestions = [];
            for (const pair of pairs) {
                if (pair.method === 'normalized_name') { suggestions.push({ ...pair, confidence: 1, reason: 'Normalized names are identical.' }); continue; }
                if (!enabled) { suggestions.push({ ...pair, confidence: Number(pair.score), reason: 'Local trigram similarity match; Jev is not configured.' }); continue; }
                try {
                    evaluated++;
                    const decision = await this.jevClient.evaluateDuplicate({ entityType: p.table, left: { name: pair.entity_name, code: pair.entity_code }, right: { name: pair.duplicate_entity_name, code: pair.duplicate_entity_code } });
                    if (!decision || decision.probability < minimumJev) { rejected++; continue; }
                    suggestions.push({ ...pair, confidence: decision.probability, method: 'pg_trgm+jev', reason: `Jev duplicate probability: ${Math.round(decision.probability * 100)}% (${decision.model}).` });
                } catch (error) {
                    failures++;
                    this.jevClient.logger?.warn?.(`Jev ${p.table} duplicate evaluation failed; retaining local candidate: ${error.message}`);
                    suggestions.push({ ...pair, confidence: Number(pair.score), reason: 'Local trigram similarity match; Jev evaluation was unavailable.' });
                }
            }
            await client.query('BEGIN');
            let createdOrUpdated = 0;
            for (const s of suggestions) {
                const { rows } = await client.query(`INSERT INTO public.${p.suggestion} (${p.id}, duplicate_${p.id}, confidence_score, detection_method, ai_reason)
                    VALUES ($1, $2, $3, $4, $5) ON CONFLICT ((LEAST(${p.id}, duplicate_${p.id})), (GREATEST(${p.id}, duplicate_${p.id})))
                    DO UPDATE SET confidence_score = EXCLUDED.confidence_score, detection_method = EXCLUDED.detection_method, ai_reason = EXCLUDED.ai_reason, updated_at = NOW()
                    WHERE ${p.suggestion}.status = 'pending' RETURNING suggestion_id`, [s.entity_id, s.duplicate_entity_id, s.confidence, s.method, s.reason]);
                createdOrUpdated += rows.length;
            }
            await client.query('COMMIT');
            return { createdOrUpdated, localCandidates: pairs.length, threshold: minimum, jev: { enabled, threshold: minimumJev, evaluated, rejected, failures } };
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }

    async suggestions() {
        const p = this.party;
        const { rows } = await this.db.query(`SELECT s.*, ${p.name} AS display_name, c.${p.code} AS entity_code, ${p.duplicateName} AS duplicate_display_name, d.${p.code} AS duplicate_entity_code
            FROM public.${p.suggestion} s JOIN ${p.table} c ON c.${p.id} = s.${p.id} JOIN ${p.table} d ON d.${p.id} = s.duplicate_${p.id}
            WHERE s.status = 'pending' AND NOT c.is_merged AND NOT d.is_merged ORDER BY s.confidence_score DESC, s.created_at DESC`);
        return rows;
    }

    validateIds(keepId, mergeIds) {
        const keep = Number(keepId), merge = [...new Set((mergeIds || []).map(Number))];
        if (!Number.isInteger(keep) || keep <= 0 || !merge.length || merge.some(id => !Number.isInteger(id) || id <= 0) || merge.includes(keep)) throw Object.assign(new Error('Choose a canonical record and at least one different record to merge.'), { statusCode: 400 });
        return [keep, ...merge];
    }

    async preview(request, employeeId) {
        return new MasterDataMergeService(this.db, this.party.table).preview(request, employeeId);
    }

    async history(limit) {
        return new MasterDataMergeService(this.db, this.party.table).history(limit);
    }

    async revert(operationId, employeeId, reason) {
        return new MasterDataMergeService(this.db, this.party.table).revert(operationId, employeeId, reason);
    }

    async execute(request, employeeId) {
        return new MasterDataMergeService(this.db, this.party.table).execute(request, employeeId);
    }

    async dismiss(suggestionId, employeeId) {
        const p = this.party;
        const { rows } = await this.db.query(`UPDATE public.${p.suggestion} SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = $2, updated_at = NOW() WHERE suggestion_id = $1 AND status = 'pending' RETURNING suggestion_id`, [suggestionId, employeeId]);
        if (!rows[0]) throw Object.assign(new Error('Suggestion was not found or is no longer pending'), { statusCode: 404 });
    }

    assertMergeable(rows, keepId, mergeIds) {
        if (rows.length !== mergeIds.length + 1) throw Object.assign(new Error('One or more records no longer exist.'), { statusCode: 409 });
        if (rows.some(row => row.is_merged || row[this.party.mergedInto])) throw Object.assign(new Error('A selected record has already been merged.'), { statusCode: 409 });
    }
}

module.exports = PartyMergeService;
