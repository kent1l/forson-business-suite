const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const fs = require('fs');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /api/purchase-orders - Get all purchase orders with status filter
router.get('/purchase-orders', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    const { status = 'Pending' } = req.query; // Default to Pending
    let whereClause = '';
    const queryParams = [];

    if (status && status !== 'All') {
        whereClause = 'WHERE po.status = $1';
        queryParams.push(status);
    }

    try {
        const query = `
            SELECT po.*, s.supplier_name, e.first_name, e.last_name
            FROM purchase_order po
            JOIN supplier s ON po.supplier_id = s.supplier_id
            JOIN employee e ON po.employee_id = e.employee_id
            ${whereClause}
            ORDER BY po.order_date DESC
        `;
        const { rows } = await db.query(query, queryParams);
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

// --- NEW ---
// GET /api/purchase-orders/:id/lines - Get all lines for a specific PO
router.get('/purchase-orders/:id/lines', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT pol.*, p.internal_sku, p.detail, b.brand_name, g.group_name
            FROM purchase_order_line pol
            JOIN part p ON pol.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE pol.po_id = $1
            ORDER BY pol.po_line_id;
        `;
        const { rows } = await db.query(query, [id]);
        // Construct display_name for frontend convenience
        const linesWithDisplayName = rows.map(line => ({
            ...line,
            display_name: `${line.group_name || ''} (${line.brand_name || ''}) | ${line.detail}`
        }));
        res.json(linesWithDisplayName);
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

// --- NEW ---
// PUT /api/purchase-orders/:id - Update a purchase order
router.put('/purchase-orders/:id', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const { id } = req.params;
    const { supplier_id, expected_date, lines, notes } = req.body;

    if (!supplier_id || !lines || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Safety check: Only allow editing of 'Pending' POs
        const statusCheck = await client.query('SELECT status FROM purchase_order WHERE po_id = $1', [id]);
        if (statusCheck.rows.length === 0) {
            return res.status(404).json({ message: 'Purchase Order not found.' });
        }
        if (statusCheck.rows[0].status !== 'Pending') {
            return res.status(400).json({ message: `Cannot edit a PO with status "${statusCheck.rows[0].status}".` });
        }

        // Update PO header
        const total_amount = lines.reduce((sum, line) => sum + (line.quantity * line.cost_price), 0);
        await client.query(
            'UPDATE purchase_order SET supplier_id = $1, expected_date = $2, total_amount = $3, notes = $4 WHERE po_id = $5',
            [supplier_id, expected_date, total_amount, notes, id]
        );

        // Replace PO lines
        await client.query('DELETE FROM purchase_order_line WHERE po_id = $1', [id]);
        for (const line of lines) {
            const { part_id, quantity, cost_price } = line;
            await client.query(
                'INSERT INTO purchase_order_line (po_id, part_id, quantity, cost_price) VALUES ($1, $2, $3, $4)',
                [id, part_id, quantity, cost_price]
            );
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Purchase Order updated successfully' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction Error:', err.message);
        res.status(500).json({ message: 'Server error during transaction.', error: err.message });
    } finally {
        client.release();
    }
});


// --- NEW ---
// PUT /api/purchase-orders/:id/status - Update a PO's status
router.put('/purchase-orders/:id/status', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Ordered', 'Cancelled'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
    }

    try {
        // Safety check: Only allow status changes from 'Pending'
        const po = await db.query('SELECT status FROM purchase_order WHERE po_id = $1', [id]);
        if (po.rows.length === 0) {
            return res.status(404).json({ message: 'Purchase Order not found.' });
        }
        if (po.rows[0].status !== 'Pending') {
            return res.status(400).json({ message: `Cannot change status from "${po.rows[0].status}".` });
        }

        const { rows } = await db.query(
            'UPDATE purchase_order SET status = $1 WHERE po_id = $2 RETURNING *',
            [status, id]
        );
        res.status(200).json(rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// DELETE /api/purchase-orders/:id - Delete a purchase order
router.delete('/purchase-orders/:id', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const { id } = req.params;
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        // For safety, only allow deleting POs that are still 'Pending'
        const check = await client.query('SELECT status FROM purchase_order WHERE po_id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ message: 'Purchase Order not found.' });
        }
        if (check.rows[0].status !== 'Pending') {
            return res.status(400).json({ message: `Cannot delete a PO with status "${check.rows[0].status}".` });
        }

        await client.query('DELETE FROM purchase_order_line WHERE po_id = $1', [id]);
        await client.query('DELETE FROM purchase_order WHERE po_id = $1', [id]);
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'Purchase Order deleted successfully.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send('Server Error');
    } finally {
        client.release();
    }
});


// GET /api/purchase-orders/:id/pdf - Generate a PDF for a specific PO
router.get('/purchase-orders/:id/pdf', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    const { id } = req.params;
    try {
    // Lazy import to avoid breaking entire router if module isn't installed yet
    const { generatePurchaseOrderPDF } = require('../helpers/pdf/purchaseOrderPdf');
        // 1. Fetch PO Header Data
    const poHeaderQuery = `
        SELECT po.*, s.supplier_name, s.address, s.email AS contact_email, e.first_name || ' ' || e.last_name as employee_name
                FROM purchase_order po
                JOIN supplier s ON po.supplier_id = s.supplier_id
                JOIN employee e ON po.employee_id = e.employee_id
                WHERE po.po_id = $1;`;
        const headerRes = await db.query(poHeaderQuery, [id]);
        if (headerRes.rows.length === 0) return res.status(404).json({ message: 'Purchase Order not found.' });
        
        // 2. Fetch PO Lines Data
        const poLinesQuery = `
                SELECT p.internal_sku, g.group_name || ' (' || b.brand_name || ') | ' || p.detail as display_name, pol.quantity, pol.cost_price
                FROM purchase_order_line pol
                JOIN part p ON pol.part_id = p.part_id
                LEFT JOIN brand b ON p.brand_id = b.brand_id
                LEFT JOIN "group" g ON p.group_id = g.group_id
                WHERE pol.po_id = $1 ORDER BY pol.po_line_id;`;
        const linesRes = await db.query(poLinesQuery, [id]);

        // 3. Generate PDF using the helper
        const pdfPath = await generatePurchaseOrderPDF(headerRes.rows[0], linesRes.rows);

        // 4. Send the file and schedule it for deletion
        res.sendFile(pdfPath, (err) => {
            if (err) console.error('Error sending PDF file:', err);
            fs.unlink(pdfPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp PDF file:', unlinkErr);
            });
        });
    } catch (err) {
        console.error('PDF route error:', err.message);
        res.status(500).send('Server Error');
    }
});


module.exports = router;