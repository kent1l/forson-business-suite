const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all numbers for a specific part
router.get('/parts/:partId/numbers', async (req, res) => {
  const { partId } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM part_number WHERE part_id = $1', [partId]);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST new numbers for a specific part
// Accepts a single string of numbers separated by commas or semicolons
router.post('/parts/:partId/numbers', async (req, res) => {
  const { partId } = req.params;
  const { numbersString } = req.body;

  if (!numbersString) {
    return res.status(400).json({ message: 'Numbers string is required.' });
  }

  // Split the string by comma or semicolon, trim whitespace, and filter out empty strings
  const numbers = numbersString.split(/[,;]/).map(num => num.trim()).filter(Boolean);

  if (numbers.length === 0) {
    return res.status(400).json({ message: 'No valid part numbers provided.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    for (const number of numbers) {
      // "ON CONFLICT DO NOTHING" prevents errors if a number already exists for this part
      const query = `
        INSERT INTO part_number (part_id, part_number)
        VALUES ($1, $2)
        ON CONFLICT (part_id, part_number) DO NOTHING;
      `;
      await client.query(query, [partId, number]);
    }

    await client.query('COMMIT');
    
    // Return the updated list of all numbers for the part
    const updatedNumbers = await client.query('SELECT * FROM part_number WHERE part_id = $1', [partId]);
    res.status(201).json(updatedNumbers.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

module.exports = router;
