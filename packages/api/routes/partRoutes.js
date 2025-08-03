const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all parts with brand and group names
router.get('/parts', async (req, res) => {
  try {
    const query = `
      SELECT
        p.*,
        b.brand_name,
        g.group_name
      FROM part AS p
      LEFT JOIN brand AS b ON p.brand_id = b.brand_id
      LEFT JOIN "group" AS g ON p.group_id = g.group_id
      ORDER BY p.part_id;
    `;
    const { rows } = await db.query(query);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// GET a single part by ID
router.get('/parts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT
        p.*,
        b.brand_name,
        g.group_name
      FROM part AS p
      LEFT JOIN brand AS b ON p.brand_id = b.brand_id
      LEFT JOIN "group" AS g ON p.group_id = g.group_id
      WHERE p.part_id = $1;
    `;
    const { rows } = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST - Create a new part
router.post('/parts', async (req, res) => {
  const {
    detail,
    brand_id,
    group_id,
    // Add other fields from your 'part' table here as needed
  } = req.body;

  if (!detail || !brand_id || !group_id) {
    return res.status(400).json({ message: 'Detail, brand_id, and group_id are required' });
  }

  try {
    const newPart = await db.query(
      'INSERT INTO part (detail, brand_id, group_id) VALUES ($1, $2, $3) RETURNING *',
      [detail, brand_id, group_id]
    );
    res.status(201).json(newPart.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// PUT - Update an existing part
router.put('/parts/:id', async (req, res) => {
    const { id } = req.params;
    const {
        detail,
        brand_id,
        group_id,
        // Add other fields here
    } = req.body;

    if (!detail || !brand_id || !group_id) {
        return res.status(400).json({ message: 'Detail, brand_id, and group_id are required' });
    }

    try {
        const updatedPart = await db.query(
            'UPDATE part SET detail = $1, brand_id = $2, group_id = $3, date_modified = CURRENT_TIMESTAMP WHERE part_id = $4 RETURNING *',
            [detail, brand_id, group_id, id]
        );

        if (updatedPart.rows.length === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }

        res.json(updatedPart.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE - Delete a part
router.delete('/parts/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deleteOp = await db.query('DELETE FROM part WHERE part_id = $1 RETURNING *', [id]);

        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Part not found' });
        }

        res.json({ message: 'Part deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;
