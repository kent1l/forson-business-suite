const express = require('express');
const db = require('../db');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/tags - Get all tags
router.get('/tags', protect, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM tag ORDER BY tag_name');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/tags - Create a new tag
router.post('/tags', protect, async (req, res) => {
    const { tag_name } = req.body;
    if (!tag_name) {
        return res.status(400).json({ message: 'Tag name is required.' });
    }

    try {
        const { rows } = await db.query(
            'INSERT INTO tag (tag_name) VALUES ($1) ON CONFLICT (tag_name) DO UPDATE SET tag_name = EXCLUDED.tag_name RETURNING *',
            [tag_name.toLowerCase()]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
