const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/payment-terms - return payment term lookup rows (days and label)
router.get('/payment-terms', protect, hasPermission('invoicing:create'), async (req, res) => {
    try {
        // Normalization: dedupe by days_to_due, keep the first term_name for that days value.
        // We'll delete duplicates where days_to_due is the same but payment_term_id is not the first.
        await db.query(`
            WITH canonical AS (
                SELECT DISTINCT ON (days_to_due) payment_term_id, term_name, days_to_due
                FROM public.payment_term
                ORDER BY days_to_due, payment_term_id
            )
            DELETE FROM public.payment_term p
            USING canonical c
            WHERE p.days_to_due = c.days_to_due
            AND p.payment_term_id <> c.payment_term_id;
        `);

        const { rows } = await db.query('SELECT payment_term_id, term_name, days_to_due FROM public.payment_term ORDER BY days_to_due');
        res.json(rows);
    } catch (err) {
        console.error('Failed to fetch payment terms', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
