const express = require('express');
const db = require('../db');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// Resolves a make by id (must exist) or by name (case/whitespace-insensitive
// get-or-create). Shared by POST/PUT /applications so both go through the same
// normalization instead of drifting apart.
async function resolveMake(client, { make_id, make }) {
    if (make_id) {
        const check = await client.query('SELECT make_id FROM vehicle_make WHERE make_id = $1', [make_id]);
        if (!check.rows.length) throw new Error('Make ID not found');
        return make_id;
    }
    if (make && make.trim()) {
        const name = make.trim();
        const existing = await client.query('SELECT make_id FROM vehicle_make WHERE lower(make_name) = lower($1)', [name]);
        if (existing.rows.length) return existing.rows[0].make_id;
        const inserted = await client.query(
            'INSERT INTO vehicle_make (make_name) VALUES ($1) ON CONFLICT (make_name) DO UPDATE SET make_name = vehicle_make.make_name RETURNING make_id',
            [name]
        );
        return inserted.rows[0].make_id;
    }
    return null;
}

async function resolveModel(client, { model_id, model, makeId }) {
    if (model_id) {
        const check = await client.query(
            'SELECT model_id FROM vehicle_model WHERE model_id = $1' + (makeId ? ' AND make_id = $2' : ''),
            makeId ? [model_id, makeId] : [model_id]
        );
        if (!check.rows.length) throw new Error('Model ID not found or does not belong to the specified make');
        return model_id;
    }
    if (model && model.trim()) {
        if (!makeId) throw new Error('A make is required to create a new model');
        const name = model.trim();
        const existing = await client.query(
            'SELECT model_id FROM vehicle_model WHERE make_id = $1 AND lower(model_name) = lower($2)',
            [makeId, name]
        );
        if (existing.rows.length) return existing.rows[0].model_id;
        const inserted = await client.query(
            'INSERT INTO vehicle_model (make_id, model_name) VALUES ($1, $2) ON CONFLICT (make_id, model_name) DO UPDATE SET model_name = vehicle_model.model_name RETURNING model_id',
            [makeId, name]
        );
        return inserted.rows[0].model_id;
    }
    return null;
}

// Engine is global master data (Phase 0) -- it is no longer scoped to a model,
// so resolving/creating one never depends on make/model being set.
async function resolveEngine(client, { engine_id, engine }) {
    if (engine_id) {
        const check = await client.query('SELECT engine_id FROM engine WHERE engine_id = $1', [engine_id]);
        if (!check.rows.length) throw new Error('Engine ID not found');
        return engine_id;
    }
    if (engine && engine.trim()) {
        const code = engine.trim();
        const existing = await client.query('SELECT engine_id FROM engine WHERE lower(engine_code) = lower($1)', [code]);
        if (existing.rows.length) return existing.rows[0].engine_id;
        const inserted = await client.query(
            'INSERT INTO engine (engine_code) VALUES ($1) ON CONFLICT (engine_code) DO UPDATE SET engine_code = engine.engine_code RETURNING engine_id',
            [code]
        );
        return inserted.rows[0].engine_id;
    }
    return null;
}

// GET all vehicle applications using the view
router.get('/applications', protect, hasPermission('applications:view'), async (req, res) => {
    console.log('[DEBUG] Handling GET /applications request');
    const { status, search, sortBy, sortOrder = 'ASC' } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    try {
        // Ensure the view has the expected columns (including *_id). If not, drop and recreate.
        const colCheck = await db.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'application_view' AND column_name = 'make_id'
            ) AS has_make_id;
        `);
        if (!colCheck.rows[0]?.has_make_id) {
            console.log('[DEBUG] application_view missing *_id columns; recreating view');
            await db.query('DROP VIEW IF EXISTS application_view');
            await db.query(`
                CREATE VIEW application_view AS
                SELECT
                    a.application_id,
                    a.make_id,
                    a.model_id,
                    a.engine_id,
                    vmk.make_name AS make,
                    vmd.model_name AS model,
                    eng.engine_code AS engine
                FROM application a
                LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
                LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
                LEFT JOIN engine eng ON a.engine_id = eng.engine_id;
            `);
        }

        let whereClause = '';
        let queryParams = [];
        let paramIdx = 1;

        if (search && search.trim()) {
            whereClause = `WHERE (
                LOWER(COALESCE(make, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(model, '')) LIKE $${paramIdx} OR
                LOWER(COALESCE(engine, '')) LIKE $${paramIdx}
            )`;
            queryParams.push(`%${search.trim().toLowerCase()}%`);
            paramIdx++;
        }

        const dir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        let orderBy = `ORDER BY make ${dir} NULLS LAST, model ${dir} NULLS LAST, engine ${dir} NULLS LAST`;
        if (sortBy === 'make') {
            orderBy = `ORDER BY make ${dir} NULLS LAST`;
        } else if (sortBy === 'model') {
            orderBy = `ORDER BY model ${dir} NULLS LAST`;
        } else if (sortBy === 'engine') {
            orderBy = `ORDER BY engine ${dir} NULLS LAST`;
        }

        console.log('[DEBUG] Executing applications query');
        const baseQuery = `
            SELECT
                application_id,
                make_id,
                model_id,
                engine_id,
                make,
                model,
                engine
            FROM application_view
            ${whereClause}
            ${orderBy}
        `;
        if (!paginated) {
            const { rows } = await db.query(baseQuery, queryParams);
            console.log('[DEBUG] Query successful, returning', rows.length, 'rows');
            return res.json(rows);
        }
        const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM application_view ${whereClause}`, queryParams);
        const total = countRes.rows[0]?.total || 0;
        const mainParams = [...queryParams, limit, offset];
        const query = `${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
        const { rows } = await db.query(query, mainParams);
        console.log('[DEBUG] Query successful, returning', rows.length, 'rows');
        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
    } catch (err) {
        console.error('[DEBUG] Error in GET /applications:', err.message);
        console.error('[DEBUG] Full error:', err);
        res.status(500).json({
            error: err.message,
            detail: err.detail,
            hint: err.hint,
            code: err.code
        });
    }
});

// GET all makes
router.get('/makes', protect, hasPermission('applications:view'), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM vehicle_make ORDER BY make_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET models for a specific make
router.get('/makes/:makeId/models', protect, hasPermission('applications:view'), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM vehicle_model WHERE make_id = $1 ORDER BY model_name', [req.params.makeId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET all engines (global master list) -- used to power "engine only, any
// vehicle" fitment entry, which doesn't start from a make/model at all.
router.get('/engines', protect, hasPermission('applications:view'), async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM engine ORDER BY engine_code');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET engines known to have been used in a specific model (via the
// vehicle_engine_fitment cross-reference, which is auto-derived as fitments are
// entered -- see partApplicationRoutes.js). This powers the cascading
// Make -> Model -> Engine picker; engine-only fitments are reached via /engines.
router.get('/models/:modelId/engines', protect, hasPermission('applications:view'), async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT e.engine_id, e.engine_code, vef.year_start, vef.year_end
             FROM vehicle_engine_fitment vef
             JOIN engine e ON e.engine_id = vef.engine_id
             WHERE vef.model_id = $1
             ORDER BY e.engine_code`,
            [req.params.modelId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/applications', protect, hasPermission('applications:edit'), async (req, res) => {
    const { make_id, model_id, engine_id, make, model, engine } = req.body;
    const client = await db.getClient();

    try {
        console.log('[DEBUG][POST /applications] incoming payload:', { make_id, model_id, engine_id, make, model, engine });
        await client.query('BEGIN');

        const finalMakeId = await resolveMake(client, { make_id, make });
        const finalModelId = await resolveModel(client, { model_id, model, makeId: finalMakeId });
        const finalEngineId = await resolveEngine(client, { engine_id, engine });

        if (!finalMakeId && !finalModelId && !finalEngineId) {
            throw new Error('At least one of make, model, or engine is required');
        }

        // Step 4: check if this exact specificity tier already exists (NULLs must
        // compare as equal here, unlike a plain `=`, to match the Phase 0 partial
        // unique indexes per tier).
        const existingApp = await client.query(
            `SELECT application_id FROM application
             WHERE make_id IS NOT DISTINCT FROM $1
               AND model_id IS NOT DISTINCT FROM $2
               AND engine_id IS NOT DISTINCT FROM $3`,
            [finalMakeId, finalModelId, finalEngineId]
        );

        let appId;
        if (existingApp.rows.length > 0) {
            console.log('[DEBUG][POST /applications] combination already exists');
            appId = existingApp.rows[0].application_id;
        } else {
            console.log('[DEBUG][POST /applications] final IDs:', { finalMakeId, finalModelId, finalEngineId });
            const insertApp = await client.query(
                'INSERT INTO application (make_id, model_id, engine_id) VALUES ($1, $2, $3) RETURNING application_id',
                [finalMakeId, finalModelId, finalEngineId]
            );
            appId = insertApp.rows[0].application_id;
        }

        await client.query('COMMIT');

        const ret = await client.query(`
            SELECT
                a.application_id,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                eng.engine_code AS engine
            FROM application a
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN engine eng ON a.engine_id = eng.engine_id
            WHERE a.application_id = $1
        `, [appId]);

        res.status(201).json(ret.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err && err.message ? err.message : err);
        if (err.message === 'Make ID not found'
            || err.message === 'Model ID not found or does not belong to the specified make'
            || err.message === 'Engine ID not found'
            || err.message === 'A make is required to create a new model'
            || err.message === 'At least one of make, model, or engine is required') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).send('Server Error');
        }
    } finally {
        client.release();
    }
});

// PUT - Update an existing application
router.put('/applications/:id', protect, hasPermission('applications:edit'), async (req, res) => {
    const { id } = req.params;
    const { make_id, model_id, engine_id, make, model, engine } = req.body;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Verify application exists
        const appRes = await client.query('SELECT application_id FROM application WHERE application_id = $1', [id]);
        if (appRes.rows.length === 0) {
            throw new Error('Application not found');
        }

        const finalMakeId = await resolveMake(client, { make_id, make });
        const finalModelId = await resolveModel(client, { model_id, model, makeId: finalMakeId });
        const finalEngineId = await resolveEngine(client, { engine_id, engine });

        if (!finalMakeId && !finalModelId && !finalEngineId) {
            throw new Error('At least one of make, model, or engine is required');
        }

        // Check if this exact specificity tier already exists on a different row
        const existingApp = await client.query(
            `SELECT application_id FROM application
             WHERE make_id IS NOT DISTINCT FROM $1
               AND model_id IS NOT DISTINCT FROM $2
               AND engine_id IS NOT DISTINCT FROM $3
               AND application_id != $4`,
            [finalMakeId, finalModelId, finalEngineId, id]
        );

        if (existingApp.rows.length > 0) {
            throw new Error('This vehicle application combination already exists');
        }

        await client.query(
            'UPDATE application SET make_id = $1, model_id = $2, engine_id = $3 WHERE application_id = $4',
            [finalMakeId, finalModelId, finalEngineId, id]
        );

        await client.query('COMMIT');

        const ret = await client.query(`
            SELECT
                a.application_id,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                eng.engine_code AS engine
            FROM application a
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN engine eng ON a.engine_id = eng.engine_id
            WHERE a.application_id = $1
        `, [id]);

        res.json(ret.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        if (err.message === 'Application not found') {
            res.status(404).json({ message: err.message });
        } else if (err.message === 'This vehicle application combination already exists'
            || err.message === 'Make ID not found'
            || err.message === 'Model ID not found or does not belong to the specified make'
            || err.message === 'Engine ID not found'
            || err.message === 'A make is required to create a new model'
            || err.message === 'At least one of make, model, or engine is required') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).send('Server Error');
        }
    } finally {
        client.release();
    }
});

// DELETE - Delete an application
router.delete('/applications/:id', protect, hasPermission('applications:edit'), async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM application WHERE application_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Application not found' });
        }
        res.json({ message: 'Application deleted successfully' });
    } catch (err) {
        // Handle foreign key violation error
        if (err.code === '23503') {
            return res.status(400).json({ message: 'Cannot delete this application because it is linked to one or more parts.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Ensure proper module exports
module.exports = router;
module.exports.router = router; // Add this line to support both export styles
