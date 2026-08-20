const express = require('express');
const db = require('../db');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const { normalizeText, normalizeName, normalizeEmail, normalizePhone } = require('../helpers/normalizeEntity');
const router = express.Router();

// GET all suppliers with status filter
router.get('/suppliers', protect, hasPermission('suppliers:view'), async (req, res) => {
  const { status = 'active', search, sortBy, sortOrder = 'ASC' } = req.query;
  const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);

  let whereConditions = [];
  let queryParams = [];
  let paramIdx = 1;

  if (status === 'active') {
    whereConditions.push('is_active = TRUE');
  } else if (status === 'inactive') {
    whereConditions.push('is_active = FALSE');
  }

  if (search && search.trim()) {
    whereConditions.push(`(
      LOWER(COALESCE(supplier_name, '')) LIKE $${paramIdx} OR
      LOWER(COALESCE(contact_person, '')) LIKE $${paramIdx} OR
      LOWER(COALESCE(phone, '')) LIKE $${paramIdx}
    )`);
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    paramIdx++;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const dir = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  let orderBy = `ORDER BY supplier_name ${dir}`;
  if (sortBy === 'contact_person') {
    orderBy = `ORDER BY contact_person ${dir} NULLS LAST`;
  } else if (sortBy === 'phone') {
    orderBy = `ORDER BY phone ${dir} NULLS LAST`;
  } else if (sortBy === 'status') {
    orderBy = `ORDER BY is_active ${dir}`;
  }

  try {
    if (!paginated) {
      const { rows } = await db.query(`SELECT * FROM supplier ${whereClause} ${orderBy}`, queryParams);
      return res.json(rows);
    }

    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM supplier ${whereClause}`, queryParams);
    const total = countRes.rows[0]?.total || 0;
    const mainParams = [...queryParams, limit, offset];
    const { rows } = await db.query(
      `SELECT * FROM supplier ${whereClause} ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      mainParams
    );
    res.json(paginatedResponse({ data: rows, page, pageSize, total }));
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new supplier
router.post('/suppliers', protect, hasPermission('suppliers:edit'), async (req, res) => {
    let { supplier_name, contact_person, phone, email, address, is_active, payment_terms_days } = req.body;
    supplier_name = normalizeText(supplier_name);
    contact_person = normalizeName(contact_person);
    phone = normalizePhone(phone);
    email = normalizeEmail(email);
    address = normalizeText(address);
    if (!supplier_name) {
        return res.status(400).json({ message: 'Supplier name is required.' });
    }
    try {
        const supplier_code = await getNextDocumentNumber(db, 'SUPP');
        const newSupplier = await db.query(
            'INSERT INTO supplier (supplier_code, supplier_name, contact_person, phone, email, address, is_active, payment_terms_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [supplier_code, supplier_name, contact_person, phone, email, address, is_active, payment_terms_days || null]
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
router.put('/suppliers/:id', protect, hasPermission('suppliers:edit'), async (req, res) => {
    const { id } = req.params;
    let { supplier_name, contact_person, phone, email, address, is_active, payment_terms_days } = req.body;
    supplier_name = normalizeText(supplier_name);
    contact_person = normalizeName(contact_person);
    phone = normalizePhone(phone);
    email = normalizeEmail(email);
    address = normalizeText(address);

    if (!supplier_name) {
        return res.status(400).json({ message: 'Supplier name is required' });
    }

    try {
        const updatedSupplier = await db.query(
            'UPDATE supplier SET supplier_name = $1, contact_person = $2, phone = $3, email = $4, address = $5, is_active = $6, payment_terms_days = $7 WHERE supplier_id = $8 RETURNING *',
            [supplier_name, contact_person, phone, email, address, is_active, payment_terms_days || null, id]
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
router.delete('/suppliers/:id', protect, hasPermission('suppliers:edit'), async (req, res) => { // FIX: Was /customers/:id
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
