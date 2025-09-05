const express = require('express');
const db = require('../db');
const router = express.Router();
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { syncPartWithMeili } = require('../meilisearch');
const { getPartDataForMeili } = require('./partRoutes');
const { activeAliasCondition, softDeleteSupported } = require('../helpers/partNumberSoftDelete');

// GET all numbers for a specific part, ordered correctly (exclude soft-deleted)
router.get('/parts/:partId/numbers', protect, hasPermission('parts:view'), async (req, res) => {
  const { partId } = req.params;
  try {
  const { rows } = await db.query(`SELECT * FROM part_number WHERE part_id = $1 AND ${activeAliasCondition('part_number')} ORDER BY display_order`, [partId]);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST new numbers for a specific part
router.post('/parts/:partId/numbers', protect, hasPermission('parts:edit'), async (req, res) => {
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
        ON CONFLICT DO NOTHING; -- uniqueness handled by partial index (active only)
      `;
      await client.query(query, [partId, number]);
    }

    await client.query('COMMIT');
    
  const updatedNumbers = await client.query(`SELECT * FROM part_number WHERE part_id = $1 AND ${activeAliasCondition('part_number')} ORDER BY display_order`, [partId]);
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
router.put('/parts/:partId/numbers/reorder', protect, hasPermission('parts:edit'), async (req, res) => {
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
            await client.query(`UPDATE part_number SET display_order = $1 WHERE part_number_id = $2 AND ${activeAliasCondition('part_number')}`, [order, id]);
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

// DELETE - Soft delete a part number (alias) ensuring at least one remains
router.delete('/parts/:partId/numbers/:numberId', protect, hasPermission('parts:edit'), async (req, res) => {
  const { partId, numberId } = req.params;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Fetch the target alias (active only)
    const targetRes = await client.query(
      `SELECT part_number_id FROM part_number WHERE part_number_id = $1 AND part_id = $2 AND ${activeAliasCondition('part_number')} FOR UPDATE`,
      [numberId, partId]
    );
    if (targetRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Part number not found' });
    }

    // Count active aliases for the part
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM part_number WHERE part_id = $1 AND ${activeAliasCondition('part_number')}`,
      [partId]
    );
    if (countRes.rows[0].cnt <= 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'At least one part number must remain.' });
    }

    // Soft delete
    if (softDeleteSupported()) {
      await client.query(
        'UPDATE part_number SET deleted_at = NOW() WHERE part_number_id = $1',
        [numberId]
      );
    } else {
      // Fallback: hard delete if migration not yet run
      await client.query('DELETE FROM part_number WHERE part_number_id = $1', [numberId]);
    }

    await client.query('COMMIT');

    // Reindex part in Meilisearch (best effort; non-blocking errors)
    try {
      const partData = await getPartDataForMeili(db, partId);
      if (partData) syncPartWithMeili(partData);
    } catch (e) {
      console.error('Meili reindex after part number delete failed', e);
    }
    return res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    return res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});
