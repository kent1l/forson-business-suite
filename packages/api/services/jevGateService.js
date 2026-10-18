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
            confirmConfidence: threshold(this.env.JEV_BRAND_CONFIRM_THRESHOLD, 0.80),
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
            confirmConfidence: threshold(this.env.JEV_GROUP_CONFIRM_THRESHOLD, 0.80),
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
        return this.#noulMatch(type, { name: normalize(name) }, rows,
            threshold(this.env.JEV_PARTY_GATE_THRESHOLD, 0.90),
            threshold(this.env.JEV_PARTY_CONFIRM_THRESHOLD, 0.80));
    }

    async #resolveCanonicalBrand(brandId) {
        if (!brandId || !this.db) return null;
        let currentId = Number(brandId);
        if (!Number.isInteger(currentId)) return null;
        let depth = 0;
        while (currentId && depth < 5) {
            depth++;
            try {
                const { rows } = await this.db.query(
                    'SELECT brand_id, brand_name, is_merged, merged_into_brand_id FROM brand WHERE brand_id = $1',
                    [currentId]
                );
                const row = rows[0];
                if (!row) return null;
                if (!row.is_merged || !row.merged_into_brand_id) {
                    return { brand_id: row.brand_id, brand_name: row.brand_name };
                }
                currentId = Number(row.merged_into_brand_id);
            } catch (err) {
                this.logger.warn?.(`Brand canonical resolution error: ${err.message}`);
                return null;
            }
        }
        return null;
    }

    async findPartDuplicate(payload) {
        if (!this.enabled() || !this.meiliClient) return null;
        const detail = normalize(payload?.detail);
        const numbers = normalize(payload?.part_numbers_string || payload?.part_numbers);
        const query = [numbers, detail].filter(Boolean).join(' ');
        if (query.length < 3) return null;
        let hits;
        try {
            const result = await this.meiliClient.index('parts').search(query, {
                limit: 8,
                attributesToRetrieve: ['part_id', 'display_name', 'detail', 'internal_sku', 'part_numbers', 'brand_id', 'brand_name', 'group_name', 'is_active'],
                filter: 'is_active = true',
            });
            hits = (result?.hits || []).filter((row) => row.part_id);
        } catch (error) {
            this.logger.warn?.(`Jev part gate search unavailable; allowing create: ${error.message}`);
            return null;
        }
        if (!hits.length) return null;

        const candidateMap = new Map();
        if (this.db) {
            try {
                const hitIds = hits.map((h) => Number(h.part_id)).filter(Number.isInteger);
                if (hitIds.length > 0) {
                    const { rows } = await this.db.query(
                        `SELECT p.part_id, p.brand_id, p.group_id, p.detail, p.internal_sku,
                                b.brand_name, b.is_merged, b.merged_into_brand_id,
                                g.group_name
                         FROM part p
                         LEFT JOIN brand b ON b.brand_id = p.brand_id
                         LEFT JOIN "group" g ON g.group_id = p.group_id
                         WHERE p.part_id = ANY($1)`,
                        [hitIds]
                    );
                    for (const row of rows) {
                        candidateMap.set(Number(row.part_id), row);
                    }
                }
            } catch (err) {
                this.logger.warn?.(`Could not load part candidate brand metadata: ${err.message}`);
            }
        }

        let proposedCanonicalBrand = null;
        if (payload?.brand_id) {
            proposedCanonicalBrand = await this.#resolveCanonicalBrand(payload.brand_id);
        }

        const candidates = [];
        for (const hit of hits) {
            const dbRow = candidateMap.get(Number(hit.part_id));
            const candidateBrandId = dbRow?.brand_id ?? hit.brand_id;
            let candidateCanonicalBrand = null;
            if (candidateBrandId) {
                if (dbRow && (!dbRow.is_merged || !dbRow.merged_into_brand_id)) {
                    candidateCanonicalBrand = { brand_id: dbRow.brand_id, brand_name: dbRow.brand_name };
                } else {
                    candidateCanonicalBrand = await this.#resolveCanonicalBrand(candidateBrandId);
                }
            }

            // Brand Identity Rule:
            // Distinct known canonical brands are separate catalog products, not reuse candidates.
            if (proposedCanonicalBrand?.brand_id && candidateCanonicalBrand?.brand_id) {
                if (Number(proposedCanonicalBrand.brand_id) !== Number(candidateCanonicalBrand.brand_id)) {
                    continue;
                }
            }

            candidates.push({
                entity_id: hit.part_id,
                entity_name: [hit.display_name || hit.detail, hit.part_numbers, hit.internal_sku].filter(Boolean).join(' | '),
                entity_code: hit.internal_sku || null,
                part_id: hit.part_id,
                display_name: hit.display_name || dbRow?.detail || hit.detail,
                detail: dbRow?.detail || hit.detail,
                internal_sku: dbRow?.internal_sku || hit.internal_sku,
                part_numbers: hit.part_numbers,
                brand_name: candidateCanonicalBrand?.brand_name || dbRow?.brand_name || hit.brand_name || null,
                group_name: dbRow?.group_name || hit.group_name || null,
            });
        }

        if (!candidates.length) return null;

        const proposed = { name: [detail, numbers].filter(Boolean).join(' | ') };
        return this.#noulPartMatch(proposed, candidates,
            threshold(this.env.JEV_PART_GATE_THRESHOLD, 0.92),
            threshold(this.env.JEV_PART_CONFIRM_THRESHOLD, 0.80));
    }

    async #noulPartMatch(proposed, candidates, minConfidence, confirmConfidence = minConfidence) {
        for (const candidate of candidates) {
            try {
                const decision = await this.jevClient.evaluateDuplicate({
                    entityType: 'part catalog item',
                    left: proposed,
                    right: { name: candidate.entity_name, code: candidate.entity_code },
                });
                if (decision?.probability >= confirmConfidence) {
                    const confidence = decision.probability;
                    return {
                        record: candidate,
                        confidence,
                        band: confidence >= minConfidence ? 'high' : 'medium',
                        model: decision.model,
                        action: 'confirm',
                    };
                }
            } catch (error) {
                this.logger.warn?.(`Jev part catalog item gate unavailable; allowing normal workflow: ${error.message}`);
                return null;
            }
        }
        return null;
    }

    async #chooseRecord({ question, input, records, id, label, instructions, minConfidence, confirmConfidence = minConfidence }) {
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
            if (!decision || decision.choice === 'no_match' || decision.confidence < confirmConfidence) return null;
            const record = records.find((row) => String(row[id]) === decision.choice);
            return record ? {
                record, confidence: decision.confidence, model: decision.model,
                action: decision.confidence >= minConfidence ? 'reuse' : 'confirm',
            } : null;
        } catch (error) {
            this.logger.warn?.(`Jev ${question} gate unavailable; allowing normal workflow: ${error.message}`);
            return null;
        }
    }

    async #chooseExisting(options) {
        const exact = options.records.find((row) => normalize(row[options.nameKey]).toLocaleLowerCase() === options.input.toLocaleLowerCase());
        if (exact) return { record: exact, confidence: 1, model: 'local-exact-match', action: 'reuse' };
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
        return rows[0] ? { record: rows[0], confidence: 1, model: 'local-exact-match', action: 'reuse' } : null;
    }

    async #noulMatch(entityType, proposed, candidates, minConfidence, confirmConfidence = minConfidence) {
        for (const candidate of candidates) {
            try {
                const decision = await this.jevClient.evaluateDuplicate({
                    entityType,
                    left: proposed,
                    right: { name: candidate.entity_name, code: candidate.entity_code },
                });
                if (decision?.probability >= confirmConfidence) return {
                    record: candidate, confidence: decision.probability, model: decision.model,
                    action: decision.probability >= minConfidence ? 'block' : 'confirm',
                };
            } catch (error) {
                this.logger.warn?.(`Jev ${entityType} gate unavailable; allowing normal workflow: ${error.message}`);
                return null;
            }
        }
        return null;
    }
}

module.exports = JevGateService;
