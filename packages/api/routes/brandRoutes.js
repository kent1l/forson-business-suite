const express = require('express');
const db = require('../db');
const { generateUniqueCode } = require('../helpers/codeGenerator');
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

// POST a new brand - if brand_code is not provided, generate one using helper
router.post('/brands', async (req, res) => {
  const { brand_name, brand_code } = req.body;
  if (!brand_name) {
    return res.status(400).json({ message: 'Brand name is required.' });
  }

  const client = await db.getClient();
  try {
    // If no brand_code supplied, generate a unique code using helper which needs a client
    let codeToUse = brand_code && brand_code.trim() !== '' ? brand_code.trim().toUpperCase() : null;
    if (!codeToUse) {
      codeToUse = await generateUniqueCode(client, brand_name, 'brand', 'brand_code');
    }

    const insertRes = await client.query(
      'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING *',
      [brand_name, codeToUse]
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
