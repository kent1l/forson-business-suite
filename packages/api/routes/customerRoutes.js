const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all customers
router.get('/customers', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM customer ORDER BY last_name, first_name');
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// We can add POST, PUT, DELETE for customers later if needed.

module.exports = router;
