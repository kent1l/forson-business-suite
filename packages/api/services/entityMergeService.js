const { normalizeText } = require('../helpers/normalizeEntity');

const ENTITIES = {
    brand: {
        table: 'brand', id: 'brand_id', name: 'brand_name', code: 'brand_code',
        mergedInto: 'merged_into_brand_id', suggestion: 'brand_duplicate_suggestion',
        alias: 'brand_alias', partColumn: 'brand_id'
    },
    group: {
        table: '"group"', id: 'group_id', name: 'group_name', code: 'group_code',
        mergedInto: 'merged_into_group_id', suggestion: 'group_duplicate_suggestion',
        alias: 'group_alias', partColumn: 'group_id'
    }
};

class EntityMergeService {
    constructor(db, entity) {
        this.db = db;
        this.entity = ENTITIES[entity];
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

    async scan({ threshold = 0.55 } = {}) {
        const e = this.entity;
        const minimum = Math.max(0.1, Math.min(0.99, Number(threshold) || 0.55));
        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(`
                WITH pairs AS (
                    SELECT a.${e.id} AS entity_id, b.${e.id} AS duplicate_entity_id,
                           similarity(LOWER(a.${e.name}), LOWER(b.${e.name})) AS score,
                           CASE WHEN regexp_replace(LOWER(a.${e.name}), '[^a-z0-9]+', '', 'g') = regexp_replace(LOWER(b.${e.name}), '[^a-z0-9]+', '', 'g')
                                THEN 'normalized_name' ELSE 'pg_trgm' END AS method
                    FROM ${e.table} a
                    JOIN ${e.table} b ON a.${e.id} < b.${e.id}
                    WHERE NOT a.is_merged AND NOT b.is_merged
                      AND similarity(LOWER(a.${e.name}), LOWER(b.${e.name})) >= $1
                )
                INSERT INTO public.${e.suggestion} (${e.id}, duplicate_${e.id}, confidence_score, detection_method, ai_reason)
                SELECT entity_id, duplicate_entity_id, score, method,
                       'Local similarity match; AI enrichment is pending Jev integration.'
                FROM pairs
                ON CONFLICT DO UPDATE SET
                    confidence_score = EXCLUDED.confidence_score,
                    detection_method = EXCLUDED.detection_method,
                    ai_reason = EXCLUDED.ai_reason,
                    updated_at = NOW()
                WHERE ${e.suggestion}.status = 'pending'
                RETURNING suggestion_id` , [minimum]);
            await client.query('COMMIT');
            return { createdOrUpdated: rows.length, threshold: minimum };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
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
