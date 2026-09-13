const express = require('express');
const db = require('../db');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const fs = require('fs');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const purchaseOrderParserAI = require('../services/ai/features/purchaseOrderParserAI');
const router = express.Router();

const PO_DRAFT_LIMIT = 5;

function validatePurchaseOrderLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return 'At least one line is required.';
    for (const line of lines) {
        if (!line.part_id && !String(line.custom_item_name || '').trim()) {
            return 'Each uncataloged line requires custom_item_name.';
        }
        if (!(Number(line.quantity) > 0) || !(Number(line.cost_price) >= 0)) {
            return 'Each line requires a positive quantity and a non-negative cost price.';
        }
    }
    return null;
}

function lineInsertValues(line) {
    return [
        line.part_id || null,
        line.part_id ? null : String(line.custom_item_name || '').trim(),
        line.unit || null,
        line.draft_part_data || null,
        Number(line.quantity),
        Number(line.cost_price),
    ];
}

// GET /api/purchase-orders - Get all purchase orders with status filter
router.get('/purchase-orders', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    const { status = 'Pending', sortBy, sortOrder = 'DESC' } = req.query;
    const { paginated, page, pageSize, offset, limit } = parsePaginationQuery(req.query);
    let whereClause = '';
    const queryParams = [];

    if (status && status !== 'All') {
        whereClause = 'WHERE po.status = $1';
        queryParams.push(status);
    }

    const dir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    let orderBy = `ORDER BY po.order_date ${dir}, po.po_id ${dir}`;
    if (sortBy === 'po_number') {
        orderBy = `ORDER BY po.po_number ${dir}`;
    } else if (sortBy === 'supplier_name') {
        orderBy = `ORDER BY s.supplier_name ${dir}`;
    } else if (sortBy === 'order_date') {
        orderBy = `ORDER BY po.order_date ${dir}`;
    } else if (sortBy === 'total_amount') {
        orderBy = `ORDER BY po.total_amount ${dir}`;
    } else if (sortBy === 'status') {
        orderBy = `ORDER BY po.status ${dir}`;
    }

    try {
        const baseQuery = `
            SELECT po.*, s.supplier_name, e.first_name, e.last_name
            FROM purchase_order po
            JOIN supplier s ON po.supplier_id = s.supplier_id
            JOIN employee e ON po.employee_id = e.employee_id
            ${whereClause}
        `;

        if (!paginated) {
            const { rows } = await db.query(
                `${baseQuery}
                 ${orderBy}`,
                queryParams
            );
            return res.json(rows);
        }

        const countQuery = `
            SELECT COUNT(*)::int AS total
            FROM purchase_order po
            ${whereClause}
        `;
        const countRes = await db.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const paginatedParams = [...queryParams, limit, offset];
        const paginationPlaceholderStart = queryParams.length + 1;
        const { rows } = await db.query(
            `${baseQuery}
             ${orderBy}
             LIMIT $${paginationPlaceholderStart} OFFSET $${paginationPlaceholderStart + 1}`,
            paginatedParams
        );

        res.json(paginatedResponse({ data: rows, page, pageSize, total }));
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

router.post('/purchase-orders/parse-lines', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 50 || lines.some(line => typeof line !== 'string' || !line.trim())) {
        return res.status(400).json({ message: 'lines must contain between 1 and 50 non-empty strings.' });
    }

    try {
        const parsedLines = await Promise.all(lines.map(rawLine => purchaseOrderParserAI.resolveLine(rawLine)));
        res.json(parsedLines);
    } catch (error) {
        console.error('[SmartPO] parse-lines failed:', error.message);
        res.status(500).json({ message: 'Could not parse purchase-order lines.' });
    }
});

router.get('/purchase-orders/drafts', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    try {
        await db.query(`DELETE FROM draft_transaction WHERE employee_id = $1 AND transaction_type = 'PO' AND expires_at <= CURRENT_TIMESTAMP`, [req.user.employee_id]);
        const { rows } = await db.query(
            `SELECT draft_id, draft_name, draft_data, last_updated, expires_at
             FROM draft_transaction
             WHERE employee_id = $1 AND transaction_type = 'PO'
             ORDER BY last_updated DESC`,
            [req.user.employee_id]
        );
        res.json(rows);
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Could not load PO drafts.' });
    }
});

router.post('/purchase-orders/drafts', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const draftData = req.body?.draft_data;
    if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData)) {
        return res.status(400).json({ message: 'draft_data must be an object.' });
    }
    try {
        const count = await db.query(
            `SELECT COUNT(*)::int AS count FROM draft_transaction
             WHERE employee_id = $1 AND transaction_type = 'PO' AND expires_at > CURRENT_TIMESTAMP`,
            [req.user.employee_id]
        );
        if (count.rows[0].count >= PO_DRAFT_LIMIT) return res.status(409).json({ message: 'You can keep at most 5 active PO drafts.' });
        const fallbackName = `Draft #${count.rows[0].count + 1}`;
        const draftName = String(req.body?.draft_name || fallbackName).trim().slice(0, 100) || fallbackName;
        const { rows } = await db.query(
            `INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at)
             VALUES ($1, 'PO', $2, $3, CURRENT_TIMESTAMP + INTERVAL '7 days')
             RETURNING draft_id, draft_name, draft_data, last_updated, expires_at`,
            [req.user.employee_id, draftName, draftData]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A PO draft with that name already exists.' });
        console.error(error.message);
        res.status(500).json({ message: 'Could not create PO draft.' });
    }
});

router.put('/purchase-orders/drafts/:draftId', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const draftData = req.body?.draft_data;
    if (!draftData || typeof draftData !== 'object' || Array.isArray(draftData)) {
        return res.status(400).json({ message: 'draft_data must be an object.' });
    }
    try {
        const name = req.body?.draft_name ? String(req.body.draft_name).trim().slice(0, 100) : null;
        const { rows } = await db.query(
            `UPDATE draft_transaction
             SET draft_data = $1, draft_name = COALESCE(NULLIF($2, ''), draft_name),
                 last_updated = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days'
             WHERE draft_id = $3 AND employee_id = $4 AND transaction_type = 'PO'
             RETURNING draft_id, draft_name, draft_data, last_updated, expires_at`,
            [draftData, name, req.params.draftId, req.user.employee_id]
        );
        if (!rows.length) return res.status(404).json({ message: 'PO draft not found.' });
        res.json(rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A PO draft with that name already exists.' });
        console.error(error.message);
        res.status(500).json({ message: 'Could not update PO draft.' });
    }
});

router.delete('/purchase-orders/drafts/:draftId', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    try {
        const result = await db.query(
            `DELETE FROM draft_transaction WHERE draft_id = $1 AND employee_id = $2 AND transaction_type = 'PO'`,
            [req.params.draftId, req.user.employee_id]
        );
        if (!result.rowCount) return res.status(404).json({ message: 'PO draft not found.' });
        res.json({ message: 'PO draft deleted.' });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Could not delete PO draft.' });
    }
});

// --- NEW ---
// GET /api/purchase-orders/:id/lines - Get all lines for a specific PO
router.get('/purchase-orders/:id/lines', protect, hasPermission('purchase_orders:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT pol.*, p.internal_sku, p.detail, p.last_sale_price AS last_sale_price, p.last_cost AS last_cost, b.brand_name, g.group_name
            FROM purchase_order_line pol
            LEFT JOIN part p ON pol.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE pol.po_id = $1
            ORDER BY pol.po_line_id;
        `;
        const { rows } = await db.query(query, [id]);
        // Construct display_name for frontend convenience
        const linesWithDisplayName = rows.map(line => ({
            ...line,
            display_name: line.part_id
                ? `${line.group_name || ''} (${line.brand_name || ''}) | ${line.detail || ''}`
                : line.custom_item_name
        }));
        res.json(linesWithDisplayName);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.patch('/purchase-orders/:id/lines/:lineId/catalog', protect, hasPermission(['purchase_orders:edit', 'goods_receipt:create']), async (req, res) => {
    const partId = Number(req.body?.part_id);
    if (!Number.isInteger(partId) || partId <= 0) return res.status(400).json({ message: 'A valid part_id is required.' });
    try {
        const { rows } = await db.query(
            `UPDATE purchase_order_line pol
             SET part_id = $1, draft_part_data = NULL
             WHERE pol.po_id = $2 AND pol.po_line_id = $3
               AND EXISTS (SELECT 1 FROM part p WHERE p.part_id = $1 AND p.is_active = true)
             RETURNING pol.po_line_id, pol.part_id`,
            [partId, req.params.id, req.params.lineId]
        );
        if (!rows.length) return res.status(404).json({ message: 'PO line or active part not found.' });
        res.json({ message: 'PO line cataloged.', po_line_id: rows[0].po_line_id, part_id: rows[0].part_id });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ message: 'Could not catalog PO line.' });
    }
});


// POST /api/purchase-orders - Create a new purchase order
router.post('/purchase-orders', protect, hasPermission('purchase_orders:edit'), async (req, res) => {
    const { supplier_id, employee_id, expected_date, lines, notes } = req.body;

    const lineError = validatePurchaseOrderLines(lines);
    if (!supplier_id || !employee_id || lineError) {
        return res.status(400).json({ message: lineError || 'Missing required fields.' });
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
            const lineQuery = `
                INSERT INTO purchase_order_line
                    (po_id, part_id, custom_item_name, unit, draft_part_data, quantity, cost_price)
                VALUES ($1, $2, $3, $4, $5, $6, $7);
            `;
            await client.query(lineQuery, [newPoId, ...lineInsertValues(line)]);
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

    const lineError = validatePurchaseOrderLines(lines);
    if (!supplier_id || lineError) {
        return res.status(400).json({ message: lineError || 'Missing required fields.' });
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
            await client.query(
                `INSERT INTO purchase_order_line
                    (po_id, part_id, custom_item_name, unit, draft_part_data, quantity, cost_price)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [id, ...lineInsertValues(line)]
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
        let generatePurchaseOrderPDF;
        try {
            ({ generatePurchaseOrderPDF } = require('../helpers/pdf/purchaseOrderPdf'));
        } catch (e) {
            if (e && (e.code === 'MODULE_NOT_FOUND' || `${e}`.includes('pdf-creator-node'))) {
                return res.status(501).json({ message: 'PDF generation is not available on this server. Please install dependencies and restart backend.' });
            }
            throw e;
        }
        console.log(`[PO-PDF][route] Start generating PDF for PO ID=${id}`);
        // 1. Fetch PO Header Data
    const poHeaderQuery = `
        SELECT po.*, s.supplier_name, s.address, s.email AS contact_email, e.first_name || ' ' || e.last_name as employee_name
                FROM purchase_order po
                JOIN supplier s ON po.supplier_id = s.supplier_id
                JOIN employee e ON po.employee_id = e.employee_id
                WHERE po.po_id = $1;`;
        const headerRes = await db.query(poHeaderQuery, [id]);
        if (headerRes.rows.length === 0) {
            console.warn(`[PO-PDF][route] PO not found for id=${id}`);
            return res.status(404).json({ message: 'Purchase Order not found.' });
        }
        
        // 2. Fetch PO Lines Data
        const poLinesQuery = `
            SELECT 
                pol.quantity,
                p.part_id,
                p.detail,
                b.brand_name,
                g.group_name,
                (SELECT display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id) AS display_name,
                (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order)
                 FROM part_number pn WHERE pn.part_id = p.part_id AND ${require('../helpers/partNumberSoftDelete').activeAliasCondition('pn')}) AS part_numbers
            FROM purchase_order_line pol
            JOIN part p ON pol.part_id = p.part_id
            LEFT JOIN brand b ON p.brand_id = b.brand_id
            LEFT JOIN "group" g ON p.group_id = g.group_id
            WHERE pol.po_id = $1
            ORDER BY pol.po_line_id;`;
        const linesRes = await db.query(poLinesQuery, [id]);
        const linesForPdf = linesRes.rows.map((row) => ({
            ...row,
            display_name: row.display_name || ''
        }));

        // 3. Fetch company settings
        const settingsRes = await db.query('SELECT setting_key, setting_value FROM settings WHERE setting_key IN ($1,$2,$3,$4,$5)', [
            'COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'COMPANY_WEBSITE'
        ]);
        const settings = settingsRes.rows.reduce((acc, { setting_key, setting_value }) => {
            acc[setting_key] = setting_value || '';
            return acc;
        }, {});
        const company = {
            name: settings.COMPANY_NAME || '',
            address: settings.COMPANY_ADDRESS || '',
            phone: settings.COMPANY_PHONE || '',
            email: settings.COMPANY_EMAIL || '',
            website: settings.COMPANY_WEBSITE || ''
        };

        // 4. Generate PDF using the helper
        console.log(`[PO-PDF][route] Lines fetched: ${linesForPdf.length}`);
        if (linesForPdf[0]) {
            console.log(`[PO-PDF][route] Sample item display_name: ${linesForPdf[0].display_name}`);
        }
        const pdfPath = await generatePurchaseOrderPDF(headerRes.rows[0], linesForPdf, { company });
        console.log(`[PO-PDF][route] PDF created at ${pdfPath}`);

    // 5. Send the file and schedule it for deletion
        res.sendFile(pdfPath, (err) => {
            if (err) console.error('Error sending PDF file:', err);
            fs.unlink(pdfPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp PDF file:', unlinkErr);
            });
        });
    } catch (err) {
        console.error('[PO-PDF][route] PDF route error:', err && err.stack ? err.stack : err);
        res.status(500).json({ message: 'Server Error generating PDF', error: String(err && err.message ? err.message : err) });
    }
});


module.exports = router;
