const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/purchase-orders - Get all purchase orders
router.get('/purchase-orders', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    try {
        const query = `
            SELECT po.*, s.supplier_name, e.first_name, e.last_name
            FROM purchase_order po
            JOIN supplier s ON po.supplier_id = s.supplier_id
            JOIN employee e ON po.employee_id = e.employee_id
            ORDER BY po.order_date DESC
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// GET /api/purchase-orders/open - Get all purchase orders that are not fully received
router.get('/purchase-orders/open', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    try {
        const query = `
            SELECT po.*, s.supplier_name
            FROM purchase_order po
            JOIN supplier s ON po.supplier_id = s.supplier_id
            WHERE po.status IN ('Pending', 'Ordered', 'Partially Received')
            ORDER BY po.order_date DESC
        `;
        const { rows } = await db.query(query);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// POST /api/purchase-orders - Create a new purchase order
router.post('/purchase-orders', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const { supplier_id, employee_id, expected_date, lines, notes } = req.body;

    if (!supplier_id || !employee_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const po_number = await getNextDocumentNumber(client, 'PO');
        const total_amount = lines.reduce((sum, line) => sum + (line.quantity * line.cost_price), 0);

        const poQuery = `
            INSERT INTO purchase_order (po_number, supplier_id, employee_id, expected_date, total_amount, notes, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Pending')
            RETURNING po_id;
        `;
        const poResult = await client.query(poQuery, [po_number, supplier_id, employee_id, expected_date, total_amount, notes]);
        const newPoId = poResult.rows[0].po_id;

        for (const line of lines) {
            const { part_id, quantity, cost_price } = line;
            const lineQuery = `
                INSERT INTO purchase_order_line (po_id, part_id, quantity, cost_price)
                VALUES ($1, $2, $3, $4);
            `;
            await client.query(lineQuery, [newPoId, part_id, quantity, cost_price]);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Purchase order created successfully', po_id: newPoId, po_number });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during transaction.', error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;