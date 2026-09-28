'use strict';

const JevClient = require('./jevClient');

const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const threshold = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0.5, Math.min(0.99, number)) : fallback;
};

/**
 * Real-time Jev gates.  Each method starts from a small local candidate set;
 * no directory-wide data is sent to the Decisions API.  A provider failure is
 * deliberately indistinguishable from no match so ordinary workflows remain
 * available during an outage.
 */
class JevGateService {
    constructor({ db, meiliClient, jevClient = new JevClient(), env = process.env, logger = console } = {}) {
        this.db = db;
        this.meiliClient = meiliClient;
        this.jevClient = jevClient;
        this.env = env;
        this.logger = logger;
    }

    enabled() { return this.jevClient.isConfigured(); }

    async chooseExistingBrand(name) {
        if (!normalize(name)) return null;
        const exact = await this.#findExact('brand', 'brand_id', 'brand_name', 'brand_code', name);
        if (exact) return exact;
        if (!this.enabled()) return null;
        const { rows } = await this.db.query(
            'SELECT brand_id, brand_name, brand_code FROM brand WHERE NOT is_merged ORDER BY brand_name LIMIT 200'
        );
        return this.#chooseExisting({
            question: 'brand', input: normalize(name), records: rows,
            id: 'brand_id', nameKey: 'brand_name', label: (row) => `${row.brand_name}${row.brand_code ? ` (${row.brand_code})` : ''}`,
            instructions: 'Does the proposed brand name refer to one of these existing brands? Choose the existing brand only when it is the same real-world brand; otherwise choose no_match.',
            minConfidence: threshold(this.env.JEV_BRAND_GATE_THRESHOLD, 0.90),
        });
    }

    async chooseExistingGroup(name) {
        if (!normalize(name)) return null;
        const exact = await this.#findExact('"group"', 'group_id', 'group_name', 'group_code', name);
        if (exact) return exact;
        if (!this.enabled()) return null;
        const { rows } = await this.db.query(
            'SELECT group_id, group_name, group_code FROM "group" WHERE NOT is_merged ORDER BY group_name LIMIT 200'
        );
        return this.#chooseExisting({
            question: 'group', input: normalize(name), records: rows,
            id: 'group_id', nameKey: 'group_name', label: (row) => `${row.group_name}${row.group_code ? ` (${row.group_code})` : ''}`,
            instructions: 'Does the proposed product group name refer to one of these existing groups? Choose the existing group only when it is the same group; otherwise choose no_match.',
            minConfidence: threshold(this.env.JEV_GROUP_GATE_THRESHOLD, 0.90),
        });
    }

    async predictGroup(detail) {
        if (!this.enabled() || normalize(detail).length < 3) return null;
        const { rows } = await this.db.query(
            'SELECT group_id, group_name, group_code FROM "group" WHERE NOT is_merged ORDER BY group_name LIMIT 200'
        );
        return this.#chooseRecord({
            question: 'group', input: normalize(detail), records: rows,
            id: 'group_id', label: (row) => `${row.group_name}${row.group_code ? ` (${row.group_code})` : ''}`,
            instructions: 'Choose the best product group for this part detail. Choose no_match if no listed group is a reliable classification.',
            minConfidence: threshold(this.env.JEV_GROUP_PREDICT_THRESHOLD, 0.80),
        });
    }

    async findPartyDuplicate(type, name) {
        if (!this.enabled() || !normalize(name)) return null;
        const isCustomer = type === 'customer';
        const table = isCustomer ? 'customer' : 'supplier';
        const id = isCustomer ? 'customer_id' : 'supplier_id';
        const display = isCustomer
            ? "COALESCE(NULLIF(company_name, ''), NULLIF(BTRIM(CONCAT_WS(' ', first_name, last_name)), ''), customer_code)"
            : 'supplier_name';
        const code = isCustomer ? 'customer_code' : 'supplier_code';
        const localThreshold = threshold(this.env.JEV_PARTY_LOCAL_THRESHOLD, 0.55);
        const { rows } = await this.db.query(`
            SELECT ${id} AS entity_id, ${display} AS entity_name, ${code} AS entity_code,
                   similarity(LOWER(${display}), LOWER($1)) AS local_score
            FROM ${table}
            WHERE NOT is_merged AND similarity(LOWER(${display}), LOWER($1)) >= $2
            ORDER BY local_score DESC, ${id} ASC LIMIT 8`, [normalize(name), localThreshold]);
        return this.#noulMatch(type, { name: normalize(name) }, rows, threshold(this.env.JEV_PARTY_GATE_THRESHOLD, 0.90));
    }

    async findPartDuplicate(payload) {
        if (!this.enabled() || !this.meiliClient) return null;
        const detail = normalize(payload?.detail);
        const numbers = normalize(payload?.part_numbers_string);
        const query = [numbers, detail].filter(Boolean).join(' ');
        if (query.length < 3) return null;
        let hits;
        try {
            const result = await this.meiliClient.index('parts').search(query, {
                limit: 8,
                attributesToRetrieve: ['part_id', 'display_name', 'detail', 'internal_sku', 'part_numbers', 'brand_name', 'group_name', 'is_active'],
                filter: 'is_active = true',
            });
            hits = (result?.hits || []).filter((row) => row.part_id);
        } catch (error) {
            this.logger.warn?.(`Jev part gate search unavailable; allowing create: ${error.message}`);
            return null;
        }
        const proposed = { name: [detail, numbers].filter(Boolean).join(' | ') };
        const candidates = hits.map((row) => ({
            entity_id: row.part_id,
            entity_name: [row.display_name || row.detail, row.part_numbers, row.internal_sku].filter(Boolean).join(' | '),
            entity_code: row.internal_sku || null,
        }));
        return this.#noulMatch('part catalog item', proposed, candidates, threshold(this.env.JEV_PART_GATE_THRESHOLD, 0.92));
    }

    async #chooseRecord({ question, input, records, id, label, instructions, minConfidence }) {
        if (!records.length) return null;
        const choices = records.map((row) => ({ value: String(row[id]), label: label(row) }));
        choices.push({ value: 'no_match', label: 'No reliable match' });
        try {
            const decision = await this.jevClient.evaluateChoice({
                question,
                state: { input, candidates: choices },
                instructions,
                choices,
            });
            if (!decision || decision.choice === 'no_match' || decision.confidence < minConfidence) return null;
            const record = records.find((row) => String(row[id]) === decision.choice);
            return record ? { record, confidence: decision.confidence, model: decision.model } : null;
        } catch (error) {
            this.logger.warn?.(`Jev ${question} gate unavailable; allowing normal workflow: ${error.message}`);
            return null;
        }
    }

    async #chooseExisting(options) {
        const exact = options.records.find((row) => normalize(row[options.nameKey]).toLocaleLowerCase() === options.input.toLocaleLowerCase());
        if (exact) return { record: exact, confidence: 1, model: 'local-exact-match' };
        if (!this.enabled()) return null;
        return this.#chooseRecord(options);
    }

    async #findExact(table, id, name, code, input) {
        const { rows } = await this.db.query(
            `SELECT ${id}, ${name}, ${code} FROM ${table}
             WHERE NOT is_merged
               AND LOWER(regexp_replace(BTRIM(${name}), '\\s+', ' ', 'g')) = LOWER($1)
             LIMIT 1`,
            [normalize(input)]
        );
        return rows[0] ? { record: rows[0], confidence: 1, model: 'local-exact-match' } : null;
    }

    async #noulMatch(entityType, proposed, candidates, minConfidence) {
        for (const candidate of candidates) {
            try {
                const decision = await this.jevClient.evaluateDuplicate({
                    entityType,
                    left: proposed,
                    right: { name: candidate.entity_name, code: candidate.entity_code },
                });
                if (decision?.probability >= minConfidence) return { record: candidate, confidence: decision.probability, model: decision.model };
            } catch (error) {
                this.logger.warn?.(`Jev ${entityType} gate unavailable; allowing normal workflow: ${error.message}`);
                return null;
            }
        }
        return null;
    }
}

module.exports = JevGateService;
