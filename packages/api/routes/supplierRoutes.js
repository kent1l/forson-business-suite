const express = require('express');
const db = require('../db');
const router = express.Router();

// GET all suppliers with status filter
router.get('/suppliers', async (req, res) => {
  const { status = 'active' } = req.query; // Default to 'active'

  let whereClause = "WHERE is_active = TRUE";
  if (status === 'inactive') {
    whereClause = "WHERE is_active = FALSE";
  } else if (status === 'all') {
    whereClause = ""; // No filter
  }

  try {
    const { rows } = await db.query(`SELECT * FROM supplier ${whereClause} ORDER BY supplier_name`);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new supplier
router.post('/suppliers', async (req, res) => {
    const { supplier_name, contact_person, phone, email, address, is_active } = req.body;
    if (!supplier_name) {
        return res.status(400).json({ message: 'Supplier name is required.' });
    }
    try {
        const newSupplier = await db.query(
            'INSERT INTO supplier (supplier_name, contact_person, phone, email, address, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [supplier_name, contact_person, phone, email, address, is_active]
        );
        res.status(201).json(newSupplier.rows[0]);
    } catch (err) {
        if (err.code === '23505') { 
            return res.status(409).json({ message: 'A supplier with this name already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT - Update an existing supplier
router.put('/suppliers/:id', async (req, res) => {
    const { id } = req.params;
    const { supplier_name, contact_person, phone, email, address, is_active } = req.body;

    if (!supplier_name) {
        return res.status(400).json({ message: 'Supplier name is required' });
    }

    try {
        const updatedSupplier = await db.query(
            'UPDATE supplier SET supplier_name = $1, contact_person = $2, phone = $3, email = $4, address = $5, is_active = $6 WHERE supplier_id = $7 RETURNING *',
            [supplier_name, contact_person, phone, email, address, is_active, id]
        );

        if (updatedSupplier.rows.length === 0) {
            return res.status(404).json({ message: 'Supplier not found' });
        }

        res.json(updatedSupplier.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A supplier with this name already exists.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE - Delete a supplier
router.delete('/suppliers/:id', async (req, res) => { // FIX: Was /customers/:id
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM supplier WHERE supplier_id = $1 RETURNING *', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ message: 'Supplier not found' });
        }
        res.json({ message: 'Supplier deleted successfully' });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(400).json({ message: 'Cannot delete this supplier because they are linked to one or more goods receipts.' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;