const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all vehicle applications using the view
router.get('/applications', async (req, res) => {
    console.log('[DEBUG] Handling GET /applications request');
    try {
        // First verify the view exists
        const viewCheck = await db.query(`
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.views 
                WHERE table_schema = 'public' 
                AND table_name = 'application_view'
            );
        `);
        
        if (!viewCheck.rows[0].exists) {
            console.error('[DEBUG] application_view does not exist');
            // Create the view if it doesn't exist
            await db.query(`
                CREATE OR REPLACE VIEW application_view AS
                SELECT 
                    a.application_id,
                    a.make_id,
                    a.model_id,
                    a.engine_id,
                    vmk.make_name AS make,
                    vmd.model_name AS model,
                    veng.engine_name AS engine
                FROM application a
                LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
                LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
                LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id;
            `);
        }

        console.log('[DEBUG] Executing applications query');
        const query = `
            SELECT 
                application_id,
                make_id,
                model_id,
                engine_id,
                make,
                model,
                engine
            FROM application_view
            ORDER BY make NULLS LAST, model NULLS LAST, engine NULLS LAST
        `;
        const { rows } = await db.query(query);
        console.log('[DEBUG] Query successful, returning', rows.length, 'rows');
        res.json(rows);
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

// POST a new vehicle application
// GET all makes
router.get('/makes', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM vehicle_make ORDER BY make_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET models for a specific make
router.get('/makes/:makeId/models', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM vehicle_model WHERE make_id = $1 ORDER BY model_name', [req.params.makeId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET engines for a specific model
router.get('/models/:modelId/engines', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM vehicle_engine WHERE model_id = $1 ORDER BY engine_name', [req.params.modelId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/applications', async (req, res) => {
    const { make_id, model_id, engine_id, make, model, engine } = req.body;
    const client = await db.getClient();

    try {
    console.log('[DEBUG][POST /applications] incoming payload:', { make_id, model_id, engine_id, make, model, engine });
        await client.query('BEGIN');

        // Step 1: Handle make (create if doesn't exist)
        let finalMakeId;
        if (make_id) {
            const makeCheck = await client.query('SELECT make_id FROM vehicle_make WHERE make_id = $1', [make_id]);
            if (!makeCheck.rows.length) {
                throw new Error('Make ID not found');
            }
            finalMakeId = make_id;
        } else if (make) {
            const makeRes = await client.query(
                'INSERT INTO vehicle_make (make_name) VALUES ($1) ON CONFLICT (make_name) DO UPDATE SET make_name = $1 RETURNING make_id',
                [make]
            );
            console.log('[DEBUG][POST /applications] makeUpsert result:', makeRes.rows);
            finalMakeId = makeRes.rows[0].make_id;
        } else {
            throw new Error('Either make_id or make name is required');
        }

        // Step 2: Handle model (create if doesn't exist)
        let finalModelId;
        if (model_id) {
            const modelCheck = await client.query(
                'SELECT model_id FROM vehicle_model WHERE model_id = $1 AND make_id = $2',
                [model_id, finalMakeId]
            );
            if (!modelCheck.rows.length) {
                throw new Error('Model ID not found or does not belong to the specified make');
            }
            finalModelId = model_id;
        } else if (model) {
            const modelRes = await client.query(
                'INSERT INTO vehicle_model (make_id, model_name) VALUES ($1, $2) ON CONFLICT (make_id, model_name) DO UPDATE SET model_name = $2 RETURNING model_id',
                [finalMakeId, model]
            );
            console.log('[DEBUG][POST /applications] modelUpsert result:', modelRes.rows);
            finalModelId = modelRes.rows[0].model_id;
        } else {
            throw new Error('Either model_id or model name is required');
        }

        // Step 3: Handle engine (create if doesn't exist and provided)
        let finalEngineId = null;
        if (engine_id) {
            const engineCheck = await client.query(
                'SELECT engine_id FROM vehicle_engine WHERE engine_id = $1 AND model_id = $2',
                [engine_id, finalModelId]
            );
            if (!engineCheck.rows.length) {
                throw new Error('Engine ID not found or does not belong to the specified model');
            }
            finalEngineId = engine_id;
        } else if (engine) {
            const engineRes = await client.query(
                'INSERT INTO vehicle_engine (model_id, engine_name) VALUES ($1, $2) ON CONFLICT (model_id, engine_name) DO UPDATE SET engine_name = $2 RETURNING engine_id',
                [finalModelId, engine]
            );
            console.log('[DEBUG][POST /applications] engineUpsert result:', engineRes.rows);
            finalEngineId = engineRes.rows[0].engine_id;
        }

        // Step 4: Create the application entry with the IDs
        console.log('[DEBUG][POST /applications] final IDs:', { finalMakeId, finalModelId, finalEngineId });
        const insertApp = await client.query(
            'INSERT INTO application (make_id, model_id, engine_id) VALUES ($1, $2, $3) ON CONFLICT (make_id, model_id, engine_id) DO UPDATE SET engine_id = $3 RETURNING application_id',
            [finalMakeId, finalModelId, finalEngineId]
        );
        console.log('[DEBUG][POST /applications] insertApp result:', insertApp.rows);

        await client.query('COMMIT');

        // Return the created application with resolved names
        const ret = await client.query(`
            SELECT 
                a.application_id,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                veng.engine_name AS engine
            FROM application a
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
            WHERE a.application_id = $1
        `, [insertApp.rows[0].application_id]);

        res.status(201).json(ret.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err && err.message ? err.message : err);
        if (err.message === 'Invalid make/model combination' || err.message === 'Invalid engine for the specified model' || err.message === 'Make and Model IDs are required together' || err.message === 'Either make/model names or make_id/model_id must be provided') {
            res.status(400).json({ message: err.message });
        } else {
            res.status(500).send('Server Error');
        }
    } finally {
        client.release();
    }
});

// PUT - Update an existing application
router.put('/applications/:id', async (req, res) => {
    const { id } = req.params;
    const { make_id, model_id, engine_id, make, model, engine } = req.body;

    if ((!make_id && !make) || (!model_id && !model)) {
        return res.status(400).json({ message: 'Make and Model information is required' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        // Verify application exists
        const appRes = await client.query('SELECT application_id FROM application WHERE application_id = $1', [id]);
        if (appRes.rows.length === 0) {
            throw new Error('Application not found');
        }

        // Handle make (get or create)
        let finalMakeId;
        if (make_id) {
            const makeCheck = await client.query('SELECT make_id FROM vehicle_make WHERE make_id = $1', [make_id]);
            if (!makeCheck.rows.length) {
                throw new Error('Make ID not found');
            }
            finalMakeId = make_id;
        } else {
            const makeRes = await client.query(
                'INSERT INTO vehicle_make (make_name) VALUES ($1) ON CONFLICT (make_name) DO UPDATE SET make_name = $1 RETURNING make_id',
                [make]
            );
            finalMakeId = makeRes.rows[0].make_id;
        }

        // Handle model (get or create)
        let finalModelId;
        if (model_id) {
            const modelCheck = await client.query(
                'SELECT model_id FROM vehicle_model WHERE model_id = $1 AND make_id = $2',
                [model_id, finalMakeId]
            );
            if (!modelCheck.rows.length) {
                throw new Error('Model ID not found or does not belong to the specified make');
            }
            finalModelId = model_id;
        } else {
            const modelRes = await client.query(
                'INSERT INTO vehicle_model (make_id, model_name) VALUES ($1, $2) ON CONFLICT (make_id, model_name) DO UPDATE SET model_name = $2 RETURNING model_id',
                [finalMakeId, model]
            );
            finalModelId = modelRes.rows[0].model_id;
        }

        // Handle engine (get or create if provided)
        let finalEngineId = null;
        if (engine_id) {
            const engineCheck = await client.query(
                'SELECT engine_id FROM vehicle_engine WHERE engine_id = $1 AND model_id = $2',
                [engine_id, finalModelId]
            );
            if (!engineCheck.rows.length) {
                throw new Error('Engine ID not found or does not belong to the specified model');
            }
            finalEngineId = engine_id;
        } else if (engine) {
            const engineRes = await client.query(
                'INSERT INTO vehicle_engine (model_id, engine_name) VALUES ($1, $2) ON CONFLICT (model_id, engine_name) DO UPDATE SET engine_name = $2 RETURNING engine_id',
                [finalModelId, engine]
            );
            finalEngineId = engineRes.rows[0].engine_id;
        }

        // Update the application
        await client.query(
            'UPDATE application SET make_id = $1, model_id = $2, engine_id = $3 WHERE application_id = $4',
            [finalMakeId, finalModelId, finalEngineId, id]
        );

        await client.query('COMMIT');

        // Return updated data
        const ret = await client.query(`
            SELECT 
                a.application_id,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                veng.engine_name AS engine
            FROM application a
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
            WHERE a.application_id = $1
        `, [id]);

        res.json(ret.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// DELETE - Delete an application
router.delete('/applications/:id', async (req, res) => {
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
