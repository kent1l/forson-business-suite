const express = require('express');
const db = require('../db');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/settings - Get all settings
// Protected for all logged-in users to view, but only admins can change.
router.get('/settings', protect, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM settings');
        // Convert the array of objects into a single key-value object for easier use on the frontend
        const settingsObject = rows.reduce((acc, setting) => {
            acc[setting.setting_key] = setting.setting_value;
            return acc;
        }, {});
        res.json(settingsObject);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT /api/settings - Update multiple settings
// Protected for Admins only
router.put('/settings', protect, isAdmin, async (req, res) => {
    const settings = req.body; // Expects an object like { SETTING_KEY: 'new_value', ... }
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        for (const key in settings) {
            if (Object.hasOwnProperty.call(settings, key)) {
                const value = settings[key];
                await client.query(
                    'UPDATE settings SET setting_value = $1 WHERE setting_key = $2',
                    [value, key]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Settings updated successfully.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
