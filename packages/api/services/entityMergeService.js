const { normalizeText } = require('../helpers/normalizeEntity');
const JevClient = require('./jevClient');
const crypto = require('crypto');

const ENTITIES = {
    brand: {
        type: 'brand', table: 'brand', id: 'brand_id', name: 'brand_name', code: 'brand_code',
        mergedInto: 'merged_into_brand_id', suggestion: 'brand_duplicate_suggestion',
        alias: 'brand_alias', partColumn: 'brand_id'
    },
    group: {
        type: 'group', table: '"group"', id: 'group_id', name: 'group_name', code: 'group_code',
        mergedInto: 'merged_into_group_id', suggestion: 'group_duplicate_suggestion',
        alias: 'group_alias', partColumn: 'group_id'
    }
};

class EntityMergeService {
    constructor(db, entity, { jevClient = new JevClient() } = {}) {
        this.db = db;
        this.entity = ENTITIES[entity];
        this.jevClient = jevClient;
        if (!this.entity) throw new Error(`Unsupported merge entity: ${entity}`);
    }

    async list() {
        const e = this.entity;
        const { rows } = await this.db.query(`
            SELECT e.*, target.${e.name} AS merged_into_name,
                   COUNT(p.part_id)::int AS part_count
            FROM ${e.table} e
            LEFT JOIN ${e.table} target ON target.${e.id} = e.${e.mergedInto}
            LEFT JOIN part p ON p.${e.partColumn} = e.${e.id}
            WHERE NOT e.is_merged
            GROUP BY e.${e.id}, target.${e.name}
            ORDER BY e.${e.name}`);
        return rows;
    }

    async update(id, values) {
        const e = this.entity;
        const name = values[e.name] === undefined ? undefined : normalizeText(values[e.name]);
        const code = values[e.code] === undefined ? undefined : String(values[e.code] || '').trim().toUpperCase();
        if (name !== undefined && !name) throw Object.assign(new Error('Name is required'), { statusCode: 400 });
        if (code === '') throw Object.assign(new Error('Code is required'), { statusCode: 400 });
        if (name === undefined && code === undefined) throw Object.assign(new Error('Provide a name or code to update'), { statusCode: 400 });
        const fields = [], params = [];
        if (name !== undefined) { params.push(name); fields.push(`${e.name} = $${params.length}`); }
        if (code !== undefined) { params.push(code); fields.push(`${e.code} = $${params.length}`); }
        params.push(id);
        const { rows } = await this.db.query(`UPDATE ${e.table} SET ${fields.join(', ')} WHERE ${e.id} = $${params.length} AND is_merged = FALSE RETURNING *`, params);
        if (!rows[0]) throw Object.assign(new Error('Entity was not found or has already been merged'), { statusCode: 404 });
        return rows[0];
    }

    async scan({ threshold = 0.55, jevThreshold = Number(process.env.JEV_DUPLICATE_THRESHOLD || 0.8) } = {}) {
        const e = this.entity;
        const minimum = Math.max(0.1, Math.min(0.99, Number(threshold) || 0.55));
        const minimumJev = Math.max(0.5, Math.min(0.99, Number(jevThreshold) || 0.8));
        const client = await this.db.getClient();
        try {
            // Keep the network call outside a transaction so an unavailable AI
            // provider cannot hold database locks during a directory scan.
            const { rows: pairs } = await client.query(`
                    SELECT a.${e.id} AS entity_id, b.${e.id} AS duplicate_entity_id,
                           similarity(LOWER(a.${e.name}), LOWER(b.${e.name})) AS score,
                           CASE WHEN regexp_replace(LOWER(a.${e.name}), '[^a-z0-9]+', '', 'g') = regexp_replace(LOWER(b.${e.name}), '[^a-z0-9]+', '', 'g')
                                THEN 'normalized_name' ELSE 'pg_trgm' END AS method,
                           a.${e.name} AS entity_name, a.${e.code} AS entity_code,
                           b.${e.name} AS duplicate_entity_name, b.${e.code} AS duplicate_entity_code
                    FROM ${e.table} a
                    JOIN ${e.table} b ON a.${e.id} < b.${e.id}
                    WHERE NOT a.is_merged AND NOT b.is_merged
                      AND similarity(LOWER(a.${e.name}), LOWER(b.${e.name})) >= $1`, [minimum]);

            const jevEnabled = this.jevClient.isConfigured();
            const cacheContext = this.jevClient.duplicateDecisionCacheKey || {
                model: this.jevClient.config?.model || 'unknown',
                promptVersion: 'duplicate-v1',
            };
            const cachedDecisions = jevEnabled ? await this.loadCachedJevDecisions(client, pairs) : new Map();
            let jevEvaluated = 0;
            let jevCached = 0;
            let jevRejected = 0;
            let jevFailures = 0;
            const suggestions = [];
            const decisionsToCache = [];
            for (const pair of pairs) {
                if (pair.method === 'normalized_name') {
                    suggestions.push({ ...pair, confidence: 1, method: 'normalized_name', reason: 'Normalized names are identical.' });
                    continue;
                }
                if (!jevEnabled) {
                    suggestions.push({ ...pair, confidence: Number(pair.score), method: 'pg_trgm', reason: 'Local trigram similarity match; Jev is not configured.' });
                    continue;
                }
                const leftFingerprint = this.duplicateInputFingerprint(pair.entity_name, pair.entity_code);
                const rightFingerprint = this.duplicateInputFingerprint(pair.duplicate_entity_name, pair.duplicate_entity_code);
                const cached = cachedDecisions.get(this.duplicatePairKey(pair.entity_id, pair.duplicate_entity_id));
                const probability = cached
                    && cached.left_input_fingerprint === leftFingerprint
                    && cached.right_input_fingerprint === rightFingerprint
                    && cached.model === cacheContext.model
                    && cached.prompt_version === cacheContext.promptVersion
                    ? Number(cached.probability)
                    : null;
                if (probability !== null) {
                    jevCached++;
                    if (probability < minimumJev) {
                        jevRejected++;
                        continue;
                    }
                    suggestions.push({ ...pair, confidence: probability, method: 'pg_trgm+jev_cache', reason: `Cached Jev duplicate probability: ${Math.round(probability * 100)}% (${cacheContext.model}).` });
                    continue;
                }
                try {
                    jevEvaluated++;
                    const decision = await this.jevClient.evaluateDuplicate({
                        entityType: e.table === 'brand' ? 'brand' : 'product group',
                        left: { name: pair.entity_name, code: pair.entity_code },
                        right: { name: pair.duplicate_entity_name, code: pair.duplicate_entity_code },
                    });
                    if (!decision) {
                        jevRejected++;
                        continue;
                    }
                    decisionsToCache.push({
                        ...pair,
                        leftFingerprint,
                        rightFingerprint,
                        probability: decision.probability,
                        model: cacheContext.model,
                        promptVersion: cacheContext.promptVersion,
                    });
                    if (decision.probability < minimumJev) {
                        jevRejected++;
                        continue;
                    }
                    suggestions.push({ ...pair, confidence: decision.probability, method: 'pg_trgm+jev', reason: `Jev duplicate probability: ${Math.round(decision.probability * 100)}% (${decision.model}).` });
                } catch (error) {
                    jevFailures++;
                    this.jevClient.logger?.warn?.(`Jev duplicate evaluation failed; retaining local candidate: ${error.message}`);
                    suggestions.push({ ...pair, confidence: Number(pair.score), method: 'pg_trgm', reason: 'Local trigram similarity match; Jev evaluation was unavailable.' });
                }
            }

            await client.query('BEGIN');
            let createdOrUpdated = 0;
            for (const decision of decisionsToCache) {
                await client.query(`
                    INSERT INTO public.entity_duplicate_decision_cache
                        (entity_type, left_entity_id, right_entity_id, left_input_fingerprint, right_input_fingerprint, model, prompt_version, probability)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (entity_type, left_entity_id, right_entity_id) DO UPDATE
                    SET left_input_fingerprint = EXCLUDED.left_input_fingerprint,
                        right_input_fingerprint = EXCLUDED.right_input_fingerprint,
                        model = EXCLUDED.model,
                        prompt_version = EXCLUDED.prompt_version,
                        probability = EXCLUDED.probability,
                        evaluated_at = NOW()`, [e.type, decision.entity_id, decision.duplicate_entity_id, decision.leftFingerprint, decision.rightFingerprint, decision.model, decision.promptVersion, decision.probability]);
            }
            for (const suggestion of suggestions) {
                const { rows } = await client.query(`
                    INSERT INTO public.${e.suggestion} (${e.id}, duplicate_${e.id}, confidence_score, detection_method, ai_reason)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT ((LEAST(${e.id}, duplicate_${e.id})), (GREATEST(${e.id}, duplicate_${e.id})))
                    DO UPDATE SET confidence_score = EXCLUDED.confidence_score,
                        detection_method = EXCLUDED.detection_method, ai_reason = EXCLUDED.ai_reason, updated_at = NOW()
                    WHERE ${e.suggestion}.status = 'pending'
                    RETURNING suggestion_id`, [suggestion.entity_id, suggestion.duplicate_entity_id, suggestion.confidence, suggestion.method, suggestion.reason]);
                createdOrUpdated += rows.length;
            }
            await client.query('COMMIT');
            return { createdOrUpdated, localCandidates: pairs.length, threshold: minimum, jev: { enabled: jevEnabled, threshold: minimumJev, evaluated: jevEvaluated, cached: jevCached, rejected: jevRejected, failures: jevFailures } };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    async loadCachedJevDecisions(client, pairs) {
        const candidates = pairs.filter(pair => pair.method !== 'normalized_name');
        if (!candidates.length) return new Map();
        const { rows } = await client.query(`
            SELECT left_entity_id, right_entity_id, left_input_fingerprint, right_input_fingerprint,
                   model, prompt_version, probability
            FROM public.entity_duplicate_decision_cache
            WHERE entity_type = $1
              AND (left_entity_id, right_entity_id) IN (
                  SELECT * FROM UNNEST($2::int[], $3::int[])
              )`, [this.entity.type, candidates.map(pair => pair.entity_id), candidates.map(pair => pair.duplicate_entity_id)]);
        return new Map(rows.map(row => [this.duplicatePairKey(row.left_entity_id, row.right_entity_id), row]));
    }

    duplicatePairKey(leftId, rightId) {
        return `${Number(leftId)}:${Number(rightId)}`;
    }

    duplicateInputFingerprint(name, code) {
        const normalizedName = String(normalizeText(typeof name === 'string' ? name : '') || '').toLocaleLowerCase();
        const normalizedCode = String(code || '').trim().toLocaleUpperCase();
        return crypto.createHash('sha256')
            .update(JSON.stringify({ name: normalizedName, code: normalizedCode }))
            .digest('hex');
    }

    async suggestions() {
        const e = this.entity;
        const { rows } = await this.db.query(`
            SELECT s.*, left_entity.${e.name} AS ${e.name}, left_entity.${e.code} AS ${e.code},
                   right_entity.${e.name} AS duplicate_${e.name}, right_entity.${e.code} AS duplicate_${e.code}
            FROM public.${e.suggestion} s
            JOIN ${e.table} left_entity ON left_entity.${e.id} = s.${e.id}
            JOIN ${e.table} right_entity ON right_entity.${e.id} = s.duplicate_${e.id}
            WHERE s.status = 'pending' AND NOT left_entity.is_merged AND NOT right_entity.is_merged
            ORDER BY s.confidence_score DESC, s.created_at DESC`);
        return rows;
    }

    async preview({ keepId, mergeIds }) {
        const e = this.entity;
        const ids = this.validateIds(keepId, mergeIds);
        const { rows } = await this.db.query(`SELECT ${e.id}, ${e.name}, ${e.code}, is_merged, ${e.mergedInto} FROM ${e.table} WHERE ${e.id} = ANY($1::int[])`, [ids]);
        this.assertMergeable(rows, keepId, mergeIds);
        const { rows: usage } = await this.db.query(`SELECT COUNT(*)::int AS parts_reassigned FROM part WHERE ${e.partColumn} = ANY($1::int[])`, [mergeIds]);
        return { keep: rows.find(row => row[e.id] === Number(keepId)), merge: rows.filter(row => mergeIds.includes(row[e.id])), impact: usage[0] };
    }

    async execute({ keepId, mergeIds, suggestionIds = [] }, employeeId) {
        const e = this.entity;
        const ids = this.validateIds(keepId, mergeIds);
        if (!Array.isArray(suggestionIds)) {
            throw Object.assign(new Error('Suggestion IDs must be an array'), { statusCode: 400 });
        }
        const selectedSuggestionIds = [...new Set(suggestionIds.map(Number))];
        if (selectedSuggestionIds.some(id => !Number.isInteger(id) || id <= 0)) {
            throw Object.assign(new Error('Suggestion IDs must be positive integers'), { statusCode: 400 });
        }
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            for (const id of [...ids].sort((a, b) => a - b)) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [id]);
            const { rows } = await client.query(`SELECT ${e.id}, ${e.name}, ${e.code}, is_merged, ${e.mergedInto} FROM ${e.table} WHERE ${e.id} = ANY($1::int[]) FOR UPDATE`, [ids]);
            this.assertMergeable(rows, keepId, mergeIds);
            const { rowCount: partsReassigned } = await client.query(`UPDATE part SET ${e.partColumn} = $1 WHERE ${e.partColumn} = ANY($2::int[])`, [keepId, mergeIds]);
            for (const source of rows.filter(row => mergeIds.includes(row[e.id]))) {
                await client.query(`INSERT INTO public.${e.alias} (${e.id}, alias_name, alias_code, source_${e.id}) VALUES ($1, $2, $3, $4) ON CONFLICT (${e.id}, alias_name) DO NOTHING`, [keepId, source[e.name], source[e.code], source[e.id]]);
            }
            await client.query(`UPDATE ${e.table} SET is_merged = TRUE, ${e.mergedInto} = $1 WHERE ${e.id} = ANY($2::int[])`, [keepId, mergeIds]);
            if (selectedSuggestionIds.length) {
                await client.query(`UPDATE public.${e.suggestion}
                    SET status = 'merged', merged_at = NOW(), merged_by = $1, updated_at = NOW()
                    WHERE suggestion_id = ANY($2::bigint[]) AND status = 'pending'`, [employeeId, selectedSuggestionIds]);
            }
            // Suggestions involving a source entity cannot be actioned after it is merged.
            // Keep the user-confirmed suggestion auditable as "merged" and dismiss all others.
            await client.query(`UPDATE public.${e.suggestion}
                SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = $1, updated_at = NOW()
                WHERE status = 'pending'
                  AND (${e.id} = ANY($2::int[]) OR duplicate_${e.id} = ANY($2::int[]))`, [employeeId, mergeIds]);
            await client.query('COMMIT');
            return { keepId: Number(keepId), mergedIds: mergeIds, partsReassigned };
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }

    async dismiss(suggestionId, employeeId) {
        const e = this.entity;
        const { rows } = await this.db.query(`UPDATE public.${e.suggestion} SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = $2, updated_at = NOW() WHERE suggestion_id = $1 AND status = 'pending' RETURNING suggestion_id`, [suggestionId, employeeId]);
        if (!rows[0]) throw Object.assign(new Error('Suggestion was not found or is no longer pending'), { statusCode: 404 });
    }

    validateIds(keepId, mergeIds) {
        const keep = Number(keepId), merge = [...new Set((mergeIds || []).map(Number))];
        if (!Number.isInteger(keep) || keep <= 0 || !merge.length || merge.some(id => !Number.isInteger(id) || id <= 0)) throw Object.assign(new Error('A positive keep ID and at least one positive merge ID are required'), { statusCode: 400 });
        if (merge.includes(keep)) throw Object.assign(new Error('The canonical entity cannot also be merged'), { statusCode: 400 });
        return [keep, ...merge];
    }

    assertMergeable(rows, keepId, mergeIds) {
        if (rows.length !== mergeIds.length + 1) throw Object.assign(new Error('One or more entities no longer exist'), { statusCode: 409 });
        if (rows.some(row => row.is_merged || row[this.entity.mergedInto])) throw Object.assign(new Error('An entity in this merge has already been merged'), { statusCode: 409 });
    }
}

module.exports = EntityMergeService;
