const { normalizeDocumentKey } = require('./supplierBillService');

// Old API callers retain their existing invoice/delivery semantics.
function referenceFromInput(body) {
  const raw = value => value == null || !String(value).trim() ? null : String(value);
  const modern = Object.prototype.hasOwnProperty.call(body, 'supplier_document_no');
  const documentNo = modern ? raw(body.supplier_document_no) : null;
  const documentType = modern ? (body.supplier_document_type || 'other') : null;
  if (documentNo && documentNo.length > 255) {
    const err = new Error('Supplier document number must be 255 characters or fewer.');
    err.statusCode = 400;
    throw err;
  }
  return {
    supplier_document_no: documentNo,
    supplier_document_type: documentType,
    physical_receipt_no: modern
      ? (documentType === 'delivery_receipt' ? documentNo : null)
      : raw(body.physical_receipt_no),
    supplier_invoice_no: modern
      ? (documentType === 'invoice' ? documentNo : raw(body.supplier_invoice_no))
      : raw(body.supplier_invoice_no) || raw(body.physical_receipt_no),
    another_delivery_confirmed: body.another_delivery_confirmed === true,
  };
}

async function findReceipts(executor, { supplierId, documentNo, documentType = null, excludeGrnId = null }) {
  const key = normalizeDocumentKey(documentNo);
  if (!key) return [];
  const { rows } = await executor.query(
    `SELECT grn_id, grn_number, workflow_status, bill_id, supplier_document_no,
            supplier_invoice_no, physical_receipt_no
     FROM goods_receipt
     WHERE supplier_id = $1 AND status <> 'Voided' AND workflow_status <> 'Cancelled'
       AND ($3::int IS NULL OR grn_id <> $3)
       AND ($4::text IS NULL OR $4 = 'other' OR supplier_document_type IS NULL
            OR supplier_document_type = 'other' OR supplier_document_type = $4)
       AND (supplier_bill_match_key(supplier_document_no) = $2
            OR supplier_bill_match_key(physical_receipt_no) = $2
            OR supplier_bill_match_key(supplier_invoice_no) = $2)
     ORDER BY receipt_date DESC, grn_id DESC`,
    [supplierId, key, excludeGrnId, documentType],
  );
  return rows;
}

async function validateReceivingReference(client, { supplierId, documentNo, documentType = null, billId, grnId, anotherDeliveryConfirmed }) {
  if (!normalizeDocumentKey(documentNo)) return;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`supplier-reference:${supplierId}:${normalizeDocumentKey(documentNo)}`]);
  const receipts = await findReceipts(client, { supplierId, documentNo, documentType, excludeGrnId: grnId });
  if (!receipts.length) return;
  // A repeated reference can represent another arrival, but never another debt or
  // a second entry of an in-progress receipt. Require a deliberate acknowledgement.
  if (anotherDeliveryConfirmed && billId && receipts.every(r =>
    r.workflow_status === 'Posted' && Number(r.bill_id) === Number(billId))) return;
  const err = new Error('This supplier document is already recorded. Review the existing receipt, or select its payable and confirm another delivery.');
  err.statusCode = 409;
  err.code = 'SUPPLIER_RECEIPT_REFERENCE_CONFLICT';
  err.existingReceipts = receipts;
  throw err;
}
module.exports = { referenceFromInput, findReceipts, validateReceivingReference };
