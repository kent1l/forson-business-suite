const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all groups
router.get('/groups', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM "group" ORDER BY group_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new group
router.post('/groups', async (req, res) => {
    const { group_name, group_code } = req.body;
    if (!group_name || !group_code) {
        return res.status(400).json({ message: 'Group name and code are required.' });
    }
    try {
        const newGroup = await db.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING *',
            [group_name, group_code]
        );
        res.status(201).json(newGroup.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;