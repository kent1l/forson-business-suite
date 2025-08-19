const express = require('express');
const db = require('../db');
const { syncPartWithMeili } = require('../meilisearch');
const { constructDisplayName } = require('../helpers/displayNameHelper');
const router = express.Router();

// Helper function to get all data for a part for Meilisearch indexing
const getPartDataForMeili = async (client, partId) => {
    const query = `
        SELECT
            p.*, b.brand_name, g.group_name,
            (SELECT STRING_AGG(pn.part_number, '; ') FROM part_number pn WHERE pn.part_id = p.part_id) as part_numbers,
            (SELECT ARRAY_AGG(
                CONCAT(a.make, ' ', a.model, COALESCE(CONCAT(' ', a.engine), ''))
            ) FROM part_application pa JOIN application a ON pa.application_id = a.application_id WHERE pa.part_id = p.part_id) AS applications_array,
            (SELECT ARRAY_AGG(t.tag_name) FROM tag t JOIN part_tag pt ON t.tag_id = pt.tag_id WHERE pt.part_id = p.part_id) AS tags_array
        FROM part AS p
        LEFT JOIN brand AS b ON p.brand_id = b.brand_id
        LEFT JOIN "group" AS g ON p.group_id = g.group_id
        WHERE p.part_id = $1
    `;
    const res = await client.query(query, [partId]);
    if (res.rows.length === 0) return null;

    const part = res.rows[0];
    return {
        ...part,
        display_name: constructDisplayName(part),
        applications: part.applications_array || [],
        tags: part.tags_array || []
    };
};


// GET all applications for a specific part
router.get('/parts/:partId/applications', async (req, res) => {
  const { partId } = req.params;
  try {
    const query = `
        SELECT pa.*, a.make, a.model, a.engine
        FROM part_application pa
        JOIN application a ON pa.application_id = a.application_id
        WHERE pa.part_id = $1;
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

module.exports = router;
