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

// POST a new brand
router.post('/brands', async (req, res) => {
    const { brand_name, brand_code } = req.body;
    if (!brand_name || !brand_code) {
        return res.status(400).json({ message: 'Brand name and code are required.' });
    }
    try {
        const newBrand = await db.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING *',
            [brand_name, brand_code]
        );
        res.status(201).json(newBrand.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
