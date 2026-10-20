'use strict';
const db = require('../db');
const paperless = require('./paperlessService');
const { getPaperlessConfig } = require('../config/paperlessConfig');

async function getBillReceipts(billId, executor = db) {
    const { rows: [bill] } = await executor.query(
        `SELECT sb.bill_id, sb.supplier_id, sb.grn_id, sb.bill_number, sb.supplier_document_no,
                s.supplier_name
         FROM supplier_bill sb JOIN supplier s ON s.supplier_id = sb.supplier_id
         WHERE sb.bill_id = $1`, [billId],
    );
    if (!bill) {
        const err = new Error('Payable not found.');
        err.statusCode = 404;
        throw err;
    }
    if (!getPaperlessConfig().isConfigured) {
        const err = new Error('Paperless receipt viewing is not configured.');
        err.statusCode = 503;
        throw err;
    }
    const { rows } = await executor.query(
        `SELECT document_no AS reference_no FROM supplier_bill_document_identity
         WHERE bill_id = $1 AND supplier_id = $2 AND status = 'active'
         UNION
         SELECT unnest(ARRAY[gr.supplier_document_no, gr.physical_receipt_no, gr.supplier_invoice_no])
         FROM goods_receipt gr
         WHERE gr.supplier_id = $2 AND (gr.bill_id = $1 OR gr.grn_id = $3)
         UNION
         SELECT receipt_number FROM goods_receipt_freight WHERE bill_id = $1 AND supplier_id = $2`,
        [billId, bill.supplier_id, bill.grn_id],
    );
    const references = [...new Set([
        bill.supplier_document_no,
        ...rows.map(r => r.reference_no),
        !bill.bill_number?.startsWith('BILL-') ? bill.bill_number : null,
    ].filter(paperless.isValidReceiptQuery))];
    const matches = await paperless.findGoodsReceiptDocuments(references, bill.supplier_name);
    const documents = new Map();
    for (const { referenceNo, document } of matches) {
        const result = documents.get(document.id) || {
            id: document.id, title: document.title, references: [],
        };
        result.references.push(referenceNo);
        documents.set(document.id, result);
    }
    return { documents: [...documents.values()], references };
}
module.exports = { getBillReceipts };
