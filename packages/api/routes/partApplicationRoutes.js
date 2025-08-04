const express = require('express');
const db = require('../db');
const router = express.Router();

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
  const { application_id } = req.body;

  if (!application_id) {
    return res.status(400).json({ message: 'Application ID is required.' });
  }

  try {
    const query = `
        INSERT INTO part_application (part_id, application_id)
        VALUES ($1, $2)
        ON CONFLICT (part_id, application_id) DO NOTHING
        RETURNING *;
    `;
    const result = await db.query(query, [partId, application_id]);
    res.status(201).json(result.rows[0]);
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
        res.json({ message: 'Application link deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
