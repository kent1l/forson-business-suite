const express = require('express');
const db = require('../db');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

// Helper to parse composite IDs like "invoice-26"
const parseDocumentId = (compositeId) => {
    const [type, id] = compositeId.split('-');
    if (!type || !id || isNaN(parseInt(id, 10))) {
        throw new Error('Invalid document ID format.');
    }
    return { type: type.toLowerCase(), id: parseInt(id, 10) };
};

// GET /documents - A unified endpoint to fetch all document types
router.get('/documents', protect, async (req, res) => {
    let { page = 1, limit = 25, type, last_days, from, to, q, sort_by = 'date', sort_dir = 'desc' } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const params = [];

    let sharedWhereClauses = '';
    if (q) {
        params.push(`%${q}%`);
        sharedWhereClauses += ` AND d.reference_id ILIKE $${params.length}`;
    }
    if (last_days && last_days !== 'custom') {
        params.push(last_days);
        sharedWhereClauses += ` AND d.date >= now() - ($${params.length}::int * interval '1 day')`;
    }
    if (from && to) {
        params.push(from, to);
        sharedWhereClauses += ` AND d.date::date BETWEEN $${params.length - 1} AND $${params.length}`;
    }

    const documentQueries = [];

    if (type === 'All' || type === 'Invoice') {
        documentQueries.push(`
            SELECT 'invoice-' || invoice_id as id, invoice_number as reference_id, 'Invoice' as type, status, invoice_date as date
            FROM invoice
        `);
    }
    if (type === 'All' || type === 'PurchaseOrders') {
        documentQueries.push(`
            SELECT 'po-' || po_id as id, po_number as reference_id, 'PurchaseOrders' as type, status, order_date as date
            FROM purchase_order
        `);
    }
    if (type === 'All' || type === 'GRN') {
        documentQueries.push(`
            SELECT 'grn-' || grn_id as id, grn_number as reference_id, 'GRN' as type, 'Final' as status, receipt_date as date
            FROM goods_receipt
        `);
    }
     if (type === 'All' || type === 'CreditNote') {
        documentQueries.push(`
            SELECT 'cn-' || cn_id as id, cn_number as reference_id, 'CreditNote' as type, 'Final' as status, refund_date as date
            FROM credit_note
        `);
    }

    const fullQuery = `
        WITH all_documents AS (
            ${documentQueries.join(' UNION ALL ')}
        )
        SELECT *
        FROM all_documents d
        WHERE 1=1 ${sharedWhereClauses}
        ORDER BY d.${sort_by === 'referenceId' ? 'reference_id' : 'date'} ${sort_dir === 'asc' ? 'ASC' : 'DESC'}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    params.push(Number(limit), offset);

    try {
        const { rows } = await db.query(fullQuery, params);
        res.json({ documents: rows });
    } catch (err) {
        console.error('Unified document fetch error:', err.message);
        res.status(500).json({ message: 'Failed to fetch documents' });
    }
});


// GET /documents/:id/preview - REBUILT to handle different document types
router.get('/documents/:id/preview', protect, async (req, res) => {
    try {
        const { type, id } = parseDocumentId(req.params.id);
        let query;
        let html = `<div style="padding:16px; font-family: sans-serif;">`;

        if (type === 'invoice') {
            query = `
                SELECT i.invoice_number, i.total_amount, c.first_name, c.last_name 
                FROM invoice i JOIN customer c ON i.customer_id = c.customer_id 
                WHERE i.invoice_id = $1
            `;
            const { rows } = await db.query(query, [id]);
            if (!rows.length) throw new Error('Invoice not found');
            const doc = rows[0];
            html += `<h2>Invoice #${doc.invoice_number}</h2><p>Customer: ${doc.first_name} ${doc.last_name}</p><p>Total: ${doc.total_amount}</p>`;
        } else {
             html += `No preview available for type '${type}'`;
        }

        html += `</div>`;
        res.json({ html });

    } catch (err) {
        console.error('documents:preview', err.message);
        res.status(500).json({ message: 'Preview generation failed' });
    }
});


// Note: The download and share routes would need similar logic to parse the ID
// and fetch the correct file path from the correct table. For now, they are left as is.

router.get('/documents/:id/download', protect, async (req, res) => {
    res.status(501).send('Download not implemented for this document type yet.');
});

router.post('/documents/:id/share', protect, async (req, res) => {
    res.status(501).send('Share not implemented for this document type yet.');
});

module.exports = router;
