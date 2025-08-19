const express = require('express');
const db = require('../db');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/drafts/:type - Get a user's draft for a specific transaction type
router.get('/drafts/:type', protect, async (req, res) => {
    const { employee_id } = req.user;
    const { type } = req.params;

    try {
        const { rows } = await db.query(
            'SELECT draft_data FROM draft_transaction WHERE employee_id = $1 AND transaction_type = $2',
            [employee_id, type.toUpperCase()]
        );

        if (rows.length > 0) {
            res.json(rows[0].draft_data);
        } else {
            res.status(404).json({ message: 'No draft found.' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/drafts/:type - Create or update a user's draft (upsert)
router.post('/drafts/:type', protect, async (req, res) => {
    const { employee_id } = req.user;
    const { type } = req.params;
    const draft_data = req.body;

    try {
        const query = `
            INSERT INTO draft_transaction (employee_id, transaction_type, draft_data)
            VALUES ($1, $2, $3)
            ON CONFLICT (employee_id, transaction_type)
            DO UPDATE SET draft_data = EXCLUDED.draft_data, last_updated = CURRENT_TIMESTAMP
            RETURNING draft_id;
        `;
        const result = await db.query(query, [employee_id, type.toUpperCase(), draft_data]);
        res.status(200).json({ message: 'Draft saved.', draft_id: result.rows[0].draft_id });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE /api/drafts/:type - Delete a user's draft
router.delete('/drafts/:type', protect, async (req, res) => {
    const { employee_id } = req.user;
    const { type } = req.params;

    try {
        await db.query(
            'DELETE FROM draft_transaction WHERE employee_id = $1 AND transaction_type = $2',
            [employee_id, type.toUpperCase()]
        );
        res.status(200).json({ message: 'Draft deleted successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;