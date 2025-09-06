const express = require('express');
const db = require('../db');
const { generateUniqueCode } = require('../helpers/codeGenerator');
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

// POST a new group - generate code if not supplied
router.post('/groups', async (req, res) => {
  const { group_name, group_code } = req.body;
  if (!group_name) {
    return res.status(400).json({ message: 'Group name is required.' });
  }

  const client = await db.getClient();
  try {
    let codeToUse = group_code && group_code.trim() !== '' ? group_code.trim().toUpperCase() : null;
    if (!codeToUse) {
      codeToUse = await generateUniqueCode(client, group_name, 'group', 'group_code');
    }

    const insertRes = await client.query(
      'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING *',
      [group_name, codeToUse]
    );
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

module.exports = router;