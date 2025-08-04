const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all numbers for a specific part, ordered correctly
router.get('/parts/:partId/numbers', async (req, res) => {
  const { partId } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM part_number WHERE part_id = $1 ORDER BY display_order', [partId]);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST new numbers for a specific part
router.post('/parts/:partId/numbers', async (req, res) => {
  const { partId } = req.params;
  const { numbersString } = req.body;

  if (!numbersString) {
    return res.status(400).json({ message: 'Numbers string is required.' });
  }

  const numbers = numbersString.split(/[,;]/).map(num => num.trim()).filter(Boolean);

  if (numbers.length === 0) {
    return res.status(400).json({ message: 'No valid part numbers provided.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    for (const number of numbers) {
      const query = `
        INSERT INTO part_number (part_id, part_number)
        VALUES ($1, $2)
        ON CONFLICT (part_id, part_number) DO NOTHING;
      `;
      await client.query(query, [partId, number]);
    }

    await client.query('COMMIT');
    
    const updatedNumbers = await client.query('SELECT * FROM part_number WHERE part_id = $1 ORDER BY display_order', [partId]);
    res.status(201).json(updatedNumbers.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// PUT - Reorder part numbers
router.put('/parts/:partId/numbers/reorder', async (req, res) => {
    const { orderedIds } = req.body; // Expect an array of part_number_id in the new order

    if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ message: 'orderedIds must be an array.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Update the display_order for each ID based on its position in the array
        for (let i = 0; i < orderedIds.length; i++) {
            const id = orderedIds[i];
            const order = i + 1; // display_order starts at 1
            await client.query('UPDATE part_number SET display_order = $1 WHERE part_number_id = $2', [order, id]);
        }

        await client.query('COMMIT');
        res.json({ message: 'Order updated successfully.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});

module.exports = router;
