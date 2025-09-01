const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

console.log('--- [DEBUG] Loading setupRoutes.js file ---');

// GET /api/setup/status - Check if an admin account exists
router.get('/setup/status', async (req, res) => {
    try {
        const result = await db.query("SELECT EXISTS (SELECT 1 FROM employee WHERE permission_level_id = 10) as admin_exists;");
        if (!result || !result.rows || result.rows.length === 0) {
            return res.status(500).json({ error: 'Unexpected database response' });
        }
        res.json({ isAdminCreated: result.rows[0].admin_exists });
    } catch (err) {
        console.error('setupRoutes: DB query failed', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Database query failed' });
    }
});

// POST /api/setup/create-admin - Create the very first admin account
router.post('/setup/create-admin', async (req, res) => {
    console.log('[DEBUG] HIT: POST /api/setup/create-admin'); // Log when the route is actually called
    const { first_name, last_name, username, password } = req.body;

    if (!username || !password || !first_name || !last_name) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // CRITICAL: Check again inside the transaction to prevent race conditions
        const adminCheck = await client.query("SELECT EXISTS (SELECT 1 FROM employee WHERE permission_level_id = 10) as admin_exists;");
        if (adminCheck.rows[0].admin_exists) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: 'An admin account already exists. Setup is complete.' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        
        const newAdmin = await client.query(
          'INSERT INTO employee (first_name, last_name, username, password_hash, password_salt, permission_level_id, is_active) VALUES ($1, $2, $3, $4, $5, 10, TRUE) RETURNING employee_id, username, first_name, last_name',
          [first_name, last_name, username, password_hash, salt]
        );

        await client.query('COMMIT');
        res.status(201).json(newAdmin.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

console.log('[DEBUG] setupRoutes.js router configured.');
module.exports = router;
