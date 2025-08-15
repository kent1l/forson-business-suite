const express = require('express');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

// GET all available permissions, grouped by category
router.get('/permissions', protect, isAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT permission_key, description, category FROM permission ORDER BY category, permission_key');
        // Group permissions by category for easier display on the frontend
        const grouped = rows.reduce((acc, permission) => {
            const { category } = permission;
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(permission);
            return acc;
        }, {});
        res.json(grouped);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET all roles (permission levels)
router.get('/roles', protect, isAdmin, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM permission_level ORDER BY permission_level_id');
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET permissions for a specific role
router.get('/roles/:id/permissions', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `SELECT p.permission_key FROM permission p
             JOIN role_permission rp ON p.permission_id = rp.permission_id
             WHERE rp.permission_level_id = $1`,
            [id]
        );
        res.json(rows.map(r => r.permission_key));
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT to update permissions for a specific role
router.put('/roles/:id/permissions', protect, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { permissions } = req.body; // Expects an array of permission_key strings

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: 'Permissions must be an array of keys.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        // Delete existing permissions for this role
        await client.query('DELETE FROM role_permission WHERE permission_level_id = $1', [id]);

        // Insert new permissions
        if (permissions.length > 0) {
            const permissionIds = await client.query(
                'SELECT permission_id FROM permission WHERE permission_key = ANY($1::text[])',
                [permissions]
            );

            for (const row of permissionIds.rows) {
                await client.query(
                    'INSERT INTO role_permission (permission_level_id, permission_id) VALUES ($1, $2)',
                    [id, row.permission_id]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Permissions updated successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
