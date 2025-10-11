const express = require('express');
const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const {
    fetchPartApplications,
    buildApplicationsJson,
    buildSearchableApplications,
    formatApplicationDisplay
} = require('../helpers/applicationHelper');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const partQuery = `
        SELECT
            p.*,
            b.brand_name,
            g.group_name,
            (SELECT string_agg(part_number, '; ') FROM part_number WHERE part_id = p.part_id) AS part_numbers,
            (SELECT array_agg(tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
        FROM part p
        LEFT JOIN brand b ON p.brand_id = b.brand_id
        LEFT JOIN "group" g ON p.group_id = g.group_id
        WHERE p.part_id = $1;
    `;

    const res = await client.query(partQuery, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    const applicationRows = await fetchPartApplications(client, partId);
    const applicationsArray = buildApplicationsJson(applicationRows);
    const searchableApplications = buildSearchableApplications(applicationRows);

    return {
        ...part,
        display_name: constructDisplayName(part),
        applications: applicationsArray,
        searchable_applications: searchableApplications,
        tags: part.tags_array || []
    };
};


// GET all applications for a specific part
router.get('/parts/:partId/applications', async (req, res) => {
  const { partId } = req.params;
    try {
        const rows = await fetchPartApplications(db, partId);
        const payload = rows.map((row) => ({
            ...row,
            source: 'flex',
            part_app_id: null,
            part_app_flex_id: row.link_id,
            display: formatApplicationDisplay(row)
        }));
        res.json(payload);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST a new application link for a part
router.post('/parts/:partId/applications', async (req, res) => {
    const { partId } = req.params;
    const { make, model, engine, notes, year_start, year_end } = req.body;

    const trimmedMake = typeof make === 'string' ? make.trim() : '';
    const trimmedModel = typeof model === 'string' ? model.trim() : '';
    const trimmedEngine = typeof engine === 'string' ? engine.trim() : '';
    const toIntOrNull = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const sanitizedYearStart = toIntOrNull(year_start);
    const sanitizedYearEnd = toIntOrNull(year_end);
    const sanitizedNotes = typeof notes === 'string' ? notes.trim() : '';

    if (!trimmedMake && !trimmedModel && !trimmedEngine) {
        return res.status(400).json({ message: 'Provide at least one of make, model, or engine.' });
    }

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const insertFlex = `
            INSERT INTO part_application_flexible (
                part_id,
                make_name,
                model_name,
                engine_name,
                year_start,
                year_end,
                notes
            )
            VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), $5, $6, NULLIF($7, ''))
            ON CONFLICT DO NOTHING
            RETURNING part_app_flex_id;
        `;
        const result = await client.query(insertFlex, [
            partId,
            trimmedMake,
            trimmedModel,
            trimmedEngine,
            sanitizedYearStart,
            sanitizedYearEnd,
            sanitizedNotes || null
        ]);

        await client.query('COMMIT');

        const rows = await fetchPartApplications(db, partId);
        let payload = null;
        if (result.rows.length === 0) {
            payload = rows.find((row) =>
                row.make === (trimmedMake || null) &&
                row.model === (trimmedModel || null) &&
                row.engine === (trimmedEngine || null) &&
                row.year_start === sanitizedYearStart &&
                row.year_end === sanitizedYearEnd &&
                (row.notes || '') === (sanitizedNotes || '')
            ) || null;
        } else {
            payload = rows.find((row) => row.link_id === result.rows[0].part_app_flex_id) || null;
        }

        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
        }

        res.status(201).json(payload || null);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

// PUT - Update an existing flexible application link
router.put('/part-applications-flex/:partAppFlexId', async (req, res) => {
    const { partAppFlexId } = req.params;
    const { make, model, engine, year_start, year_end, notes } = req.body;

    const toIntOrNull = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const trimmedMake = typeof make === 'string' ? make.trim() : '';
    const trimmedModel = typeof model === 'string' ? model.trim() : '';
    const trimmedEngine = typeof engine === 'string' ? engine.trim() : '';
    const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';

    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const updateRes = await client.query(
            `UPDATE part_application_flexible
             SET make_name = NULLIF($1, ''),
                 model_name = NULLIF($2, ''),
                 engine_name = NULLIF($3, ''),
                 year_start = $4,
                 year_end = $5,
                 notes = NULLIF($6, ''),
                 updated_at = CURRENT_TIMESTAMP
             WHERE part_app_flex_id = $7
             RETURNING part_id;`,
            [
                trimmedMake,
                trimmedModel,
                trimmedEngine,
                toIntOrNull(year_start),
                toIntOrNull(year_end),
                trimmedNotes,
                partAppFlexId
            ]
        );

        if (updateRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Flexible application link not found' });
        }

        const partId = updateRes.rows[0].part_id;
        await client.query('COMMIT');

        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
        }

        const rows = await fetchPartApplications(db, partId);
        const payload = rows.find((row) => row.source === 'flex' && row.link_id === Number(partAppFlexId));
        res.json(payload || null);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});


// DELETE a flexible application link from a part
router.delete('/parts/:partId/flexible-applications/:flexId', async (req, res) => {
    const { partId, flexId } = req.params;
    try {
        const deleteOp = await db.query(
            'DELETE FROM part_application_flexible WHERE part_id = $1 AND part_app_flex_id = $2',
            [partId, flexId]
        );

        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Flexible application link not found.' });
        }

        const partForMeili = await getPartDataForMeili(db, partId);
        if (partForMeili) {
            syncPartWithMeili(partForMeili);
        }

        res.json({ message: 'Flexible application link deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /reindex/parts - Reindex all parts in Meilisearch
router.post('/reindex/parts', async (req, res) => {
    try {
        const allPartsQuery = `
            SELECT p.part_id 
            FROM part p
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
