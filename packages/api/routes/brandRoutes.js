const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all brands
router.get('/brands', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM brand ORDER BY brand_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
