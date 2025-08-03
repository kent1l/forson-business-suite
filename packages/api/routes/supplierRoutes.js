const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all suppliers
router.get('/suppliers', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM supplier ORDER BY supplier_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;