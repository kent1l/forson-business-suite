const express = require('express');
const db = require('../db');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

function resolveSlot(req) {
    const raw = req.query?.slot || req.query?.draft_name || req.body?.slot || req.body?.draft_name;
    if (raw && typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return 'Draft';
}

// GET /api/drafts/:type - Get a user's draft for a specific transaction type and slot
router.get('/drafts/:type', protect, async (req, res) => {
    const { employee_id } = req.user;
    const { type } = req.params;
    const slot = resolveSlot(req);

    try {
        const { rows } = await db.query(
            `SELECT draft_id, draft_name, draft_data, last_updated
             FROM draft_transaction
             WHERE employee_id = $1 AND transaction_type = $2 AND draft_name = $3`,
            [employee_id, type.toUpperCase(), slot]
        );

        if (rows.length > 0) {
            const row = rows[0];
            res.set('X-Draft-Revision', row.last_updated ? new Date(row.last_updated).toISOString() : '');
            res.set('X-Draft-Slot', row.draft_name);
            // If caller requested wrapped format:
            if (req.query?.meta === 'true') {
                return res.json({
                    draft_id: row.draft_id,
                    slot: row.draft_name,
                    last_updated: row.last_updated,
                    data: row.draft_data,
                });
            }
            res.json(row.draft_data);
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
    const slot = resolveSlot(req);

    // Support both raw payload and wrapped { data, expected_revision }
    let draftData = req.body;
    let expectedRevision = req.body?.expected_revision || req.headers['x-expected-draft-revision'];
    if (req.body && req.body.data !== undefined && req.body.expected_revision !== undefined) {
        draftData = req.body.data;
    }

    try {
        if (expectedRevision) {
            const { rows: [existing] } = await db.query(
                `SELECT last_updated FROM draft_transaction
                 WHERE employee_id = $1 AND transaction_type = $2 AND draft_name = $3`,
                [employee_id, type.toUpperCase(), slot]
            );
            if (existing && existing.last_updated) {
                const existingIso = new Date(existing.last_updated).toISOString();
                const expectedIso = new Date(expectedRevision).toISOString();
                if (existingIso !== expectedIso) {
                    return res.status(409).json({
                        code: 'DRAFT_CONFLICT',
                        message: 'Draft was updated in another window or session.',
                        last_updated: existing.last_updated,
                    });
                }
            }
        }

        const query = `
            INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '7 days')
            ON CONFLICT (employee_id, transaction_type, draft_name)
            DO UPDATE SET draft_data = EXCLUDED.draft_data,
                          last_updated = CURRENT_TIMESTAMP,
                          expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days'
            RETURNING draft_id, last_updated;
        `;
        const result = await db.query(query, [employee_id, type.toUpperCase(), slot, draftData]);
        const updated = result.rows[0];
        res.status(200).json({
            message: 'Draft saved.',
            draft_id: updated.draft_id,
            slot,
            last_updated: updated.last_updated,
        });
    } catch (err) {
        console.error(err.message);
        if (err.code === '23514') {
            return res.status(409).json({ message: 'Draft references an inactive or merged master record. Refresh the selection.' });
        }
        res.status(500).send('Server Error');
    }
});

// DELETE /api/drafts/:type - Delete a user's draft in a specific slot
router.delete('/drafts/:type', protect, async (req, res) => {
    const { employee_id } = req.user;
    const { type } = req.params;
    const slot = resolveSlot(req);

    try {
        await db.query(
            'DELETE FROM draft_transaction WHERE employee_id = $1 AND transaction_type = $2 AND draft_name = $3',
            [employee_id, type.toUpperCase(), slot]
        );
        res.status(200).json({ message: 'Draft deleted successfully.', slot });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
