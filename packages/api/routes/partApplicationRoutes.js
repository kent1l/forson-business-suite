const express = require('express');
const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        WITH app_data AS (
            SELECT
                pa.part_id,
                jsonb_agg(
                    jsonb_build_object(
                        'application_id', a.application_id,
                        'make_id', a.make_id,
                        'model_id', a.model_id,
                        'engine_id', a.engine_id,
                        'make', vmk.make_name,
                        'model', vmd.model_name,
                        'engine', veng.engine_name,
                        'year_start', pa.year_start,
                        'year_end', pa.year_end,
                        'display', CONCAT(
                            vmk.make_name,
                            CASE WHEN vmd.model_name IS NOT NULL THEN CONCAT(' ', vmd.model_name) ELSE '' END,
                            CASE WHEN veng.engine_name IS NOT NULL THEN CONCAT(' ', veng.engine_name) ELSE '' END,
                            CASE
                                WHEN pa.year_start IS NOT NULL AND pa.year_end IS NOT NULL THEN CONCAT(' (', pa.year_start, '-', pa.year_end, ')')
                                WHEN pa.year_start IS NOT NULL THEN CONCAT(' (', pa.year_start, ')')
                                WHEN pa.year_end IS NOT NULL THEN CONCAT(' (', pa.year_end, ')')
                                ELSE ''
                            END
                        )
                    )
                ) AS applications,
                string_agg(
                    CONCAT(
                        vmk.make_name,
                        CASE WHEN vmd.model_name IS NOT NULL THEN CONCAT(' ', vmd.model_name) ELSE '' END,
                        CASE WHEN veng.engine_name IS NOT NULL THEN CONCAT(' ', veng.engine_name) ELSE '' END
                    ),
                    '; '
                ) AS searchable_applications
            FROM part_application pa
            JOIN application a ON pa.application_id = a.application_id
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
            WHERE pa.part_id = $1
            GROUP BY pa.part_id
        )
        SELECT
            p.*,
            b.brand_name,
            g.group_name,
            (SELECT string_agg(part_number, '; ') FROM part_number WHERE part_id = p.part_id) as part_numbers,
            app_data.applications as applications_array,
            app_data.searchable_applications,
            (SELECT array_agg(tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
        FROM part p
        LEFT JOIN brand b ON p.brand_id = b.brand_id
        LEFT JOIN "group" g ON p.group_id = g.group_id
        LEFT JOIN app_data ON app_data.part_id = p.part_id
        WHERE p.part_id = $1;
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    return {
        ...part,
        display_name: constructDisplayName(part),
        applications: part.applications_array || [],
        searchable_applications: part.searchable_applications || '',
        tags: part.tags_array || []
    };
};


// GET all applications for a specific part
router.get('/parts/:partId/applications', async (req, res) => {
  const { partId } = req.params;
    try {
        const query = `
            SELECT 
                pa.*,
                a.make_id,
                a.model_id,
                a.engine_id,
                vmk.make_name AS make,
                vmd.model_name AS model,
                veng.engine_name AS engine
            FROM part_application pa
            JOIN application a ON pa.application_id = a.application_id
            LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
            LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
            LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
            WHERE pa.part_id = $1
            ORDER BY vmk.make_name, vmd.model_name, veng.engine_name;
        `;
        const { rows } = await db.query(query, [partId]);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST a new application link for a part
router.post('/parts/:partId/applications', async (req, res) => {
  const { partId } = req.params;
  const { application_id, year_start, year_end } = req.body;

  if (!application_id) {
    return res.status(400).json({ message: 'Application ID is required.' });
  }

  try {
    const query = `
        INSERT INTO part_application (part_id, application_id, year_start, year_end)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (part_id, application_id) DO NOTHING
        RETURNING *;
    `;
    const result = await db.query(query, [partId, application_id, year_start || null, year_end || null]);
    
    // Re-sync part with Meilisearch
    const partForMeili = await getPartDataForMeili(db, partId);
    if (partForMeili) {
        syncPartWithMeili(partForMeili);
    }
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PUT - Update year range for an existing application link
router.put('/part-applications/:partAppId', async (req, res) => {
    const { partAppId } = req.params;
    const { year_start, year_end } = req.body;

    try {
        const updatedLink = await db.query(
            'UPDATE part_application SET year_start = $1, year_end = $2 WHERE part_app_id = $3 RETURNING *',
            [year_start || null, year_end || null, partAppId]
        );

        if (updatedLink.rows.length === 0) {
            return res.status(404).json({ message: 'Application link not found' });
        }

        // Re-sync part with Meilisearch
        const partId = updatedLink.rows[0].part_id;
        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
        }

        res.json(updatedLink.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// DELETE an application link from a part
router.delete('/parts/:partId/applications/:appId', async (req, res) => {
    const { partId, appId } = req.params;
    try {
        const deleteOp = await db.query(
            'DELETE FROM part_application WHERE part_id = $1 AND application_id = $2',
            [partId, appId]
        );
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Application link not found.' });
        }

        // Re-sync part with Meilisearch
        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
        }

        res.json({ message: 'Application link deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /reindex/parts - Reindex all parts in Meilisearch
router.post('/reindex/parts', async (req, res) => {
    try {
        const allPartsQuery = `
            SELECT DISTINCT p.part_id 
            FROM part p
            LEFT JOIN part_application pa ON p.part_id = pa.part_id
        `;
        const { rows } = await db.query(allPartsQuery);
        
        // Process parts in batches
        const batchSize = 50;
        let indexed = 0;
        
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const partDataPromises = batch.map(row => getPartDataForMeili(db, row.part_id));
            const partDataBatch = await Promise.all(partDataPromises);
            const validPartData = partDataBatch.filter(Boolean);
            
            if (validPartData.length > 0) {
                await syncPartWithMeili(validPartData);
                indexed += validPartData.length;
            }
        }
        
        res.json({ indexed });
    } catch (err) {
        console.error('Parts reindex failed:', err.message);
        res.status(500).json({ error: 'Reindex failed' });
    }
});

module.exports = router;
