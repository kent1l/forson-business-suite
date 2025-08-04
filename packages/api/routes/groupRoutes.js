const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all groups
router.get('/groups', async (req, res) => {
  try {
    // Note: "group" is a reserved keyword in SQL, so it must be in double quotes.
    const { rows } = await db.query('SELECT * FROM "group" ORDER BY group_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
