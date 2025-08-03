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

// GET a single supplier by ID
router.get('/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM supplier WHERE supplier_id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST - Create a new supplier
router.post('/suppliers', async (req, res) => {
  const { supplier_name, contact_person, phone, email, address } = req.body;

  // Basic validation
  if (!supplier_name) {
    return res.status(400).json({ message: 'Supplier name is required' });
  }

  try {
    const newSupplier = await db.query(
      'INSERT INTO supplier (supplier_name, contact_person, phone, email, address) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [supplier_name, contact_person, phone, email, address]
    );
    res.status(201).json(newSupplier.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// PUT - Update an existing supplier
router.put('/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const { supplier_name, contact_person, phone, email, address } = req.body;

  if (!supplier_name) {
    return res.status(400).json({ message: 'Supplier name is required' });
  }

  try {
    const updatedSupplier = await db.query(
      'UPDATE supplier SET supplier_name = $1, contact_person = $2, phone = $3, email = $4, address = $5, date_modified = CURRENT_TIMESTAMP WHERE supplier_id = $6 RETURNING *',
      [supplier_name, contact_person, phone, email, address, id]
    );

    if (updatedSupplier.rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    res.json(updatedSupplier.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// DELETE - Delete a supplier
router.delete('/suppliers/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleteOp = await db.query(
      'DELETE FROM supplier WHERE supplier_id = $1 RETURNING *',
      [id]
    );

    if (deleteOp.rowCount === 0) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    res.json({ message: 'Supplier deleted successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;