const apLedgerService = require('./apLedgerService');
const grnCosting = require('./grnCostingService');

/**
 * Normalizes reference text for conservative matching:
 * trims outer whitespace and lowercases, but preserves internal punctuation,
 * prefixes, and leading zeroes.
 */
function normalizeDocumentKey(val) {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  return s.length > 0 ? s : null;
}

/**
 * Register a document identity (invoice or delivery receipt) for a bill.
 * Fails if the identity is already active on another bill for this supplier.
 */
async function registerBillIdentity(client, {
  billId,
  supplierId,
  documentType,
  documentNo,
  isPrimary = true,
}) {
  if (!documentNo) return null;
  documentType = documentType || 'other';
  const normalizedKey = normalizeDocumentKey(documentNo);
  if (!normalizedKey) return null;

  // Serialize reference checks across manual payable and receiving entry points.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`supplier-reference:${supplierId}:${normalizedKey}`]);

  // Unknown document labels must not bypass a previously recorded reference.
  await assertBillReferenceAvailable(client, { supplierId, documentType, documentNo, billId });

  // Check for active conflict with another bill
  const { rows: conflicts } = await client.query(
    `SELECT id.identity_id, id.bill_id, id.document_type, id.document_no,
            sb.bill_number, sb.status, sb.total_amount
     FROM supplier_bill_document_identity id
     JOIN supplier_bill sb ON sb.bill_id = id.bill_id
     WHERE id.supplier_id = $1
       AND ($2::text IS NULL OR id.document_type = $2 OR id.document_type = 'other')
       AND id.normalized_key = $3
       AND id.status = 'active'
       AND id.bill_id <> $4`,
    [supplierId, documentType, normalizedKey, billId],
  );

  if (conflicts.length > 0) {
    const conflict = conflicts[0];
    const err = new Error(
      `Supplier document ${documentType.toUpperCase()} "${documentNo}" is already assigned to bill ${conflict.bill_number}.`,
    );
    err.statusCode = 409;
    err.code = 'BILL_IDENTITY_CONFLICT';
    err.conflictingBill = {
      bill_id: conflict.bill_id,
      bill_number: conflict.bill_number,
      status: conflict.status,
      total_amount: conflict.total_amount,
    };
    throw err;
  }

  const { rows: [identity] } = await client.query(
    `INSERT INTO supplier_bill_document_identity
       (bill_id, supplier_id, document_type, document_no, normalized_key, is_primary, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (supplier_id, document_type, normalized_key) WHERE (status = 'active')
     DO UPDATE SET is_primary = supplier_bill_document_identity.is_primary OR EXCLUDED.is_primary
     WHERE supplier_bill_document_identity.bill_id = EXCLUDED.bill_id
     RETURNING identity_id`,
    [billId, supplierId, documentType, String(documentNo).trim(), normalizedKey, !!isPrimary],
  );

  return identity?.identity_id || null;
}

async function assertBillReferenceAvailable(client, { supplierId, documentType = 'other', documentNo, billId = null }) {
  const key = normalizeDocumentKey(documentNo);
  if (!key) return;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`supplier-reference:${supplierId}:${key}`]);
  const { rows: [conflict] } = await client.query(
    `SELECT sb.bill_id, sb.bill_number, sb.supplier_document_no, sb.status
     FROM supplier_bill sb
     WHERE sb.supplier_id = $1 AND sb.status <> 'Void'
       AND ($4::int IS NULL OR sb.bill_id <> $4)
       AND (EXISTS (
         SELECT 1 FROM supplier_bill_document_identity di
         WHERE di.bill_id = sb.bill_id AND di.status = 'active' AND di.normalized_key = $2
           AND ($3 = 'other' OR di.document_type = 'other' OR di.document_type = $3)
       ) OR (supplier_bill_match_key(sb.supplier_document_no) = $2
             AND ($3 = 'other' OR sb.supplier_document_type IS NULL OR sb.supplier_document_type = 'other' OR sb.supplier_document_type = $3))
         OR (sb.supplier_document_no IS NULL AND sb.bill_number NOT LIKE 'BILL-%'
             AND supplier_bill_match_key(sb.bill_number) = $2))
     LIMIT 1`,
    [supplierId, key, documentType || 'other', billId],
  );
  if (conflict) {
    const err = new Error(`Supplier reference "${documentNo}" is already recorded. Open the existing payable instead of creating another debt.`);
    err.statusCode = 409;
    err.code = 'BILL_IDENTITY_CONFLICT';
    err.conflictingBill = conflict;
    throw err;
  }
}

/**
 * Release active identities for a bill (e.g. upon voiding).
 */
async function releaseBillIdentities(client, billId) {
  await client.query(
    `UPDATE supplier_bill_document_identity
     SET status = 'released'
     WHERE bill_id = $1 AND status = 'active'`,
    [billId],
  );
}

/**
 * Validates a supplier bill under row lock for receiving goods.
 * Allows Unpaid, Partially Paid, and Paid bills. Disallows Void bills or supplier mismatches.
 */
async function validateBillForReceiving(client, { billId, supplierId }) {
  const { rows: [bill] } = await client.query(
    `SELECT bill_id, bill_number, supplier_id, total_amount, amount_paid, status,
            liability_basis, supplier_document_type, supplier_document_no
     FROM supplier_bill
     WHERE bill_id = $1
     FOR UPDATE`,
    [billId],
  );

  if (!bill) {
    const err = new Error('The selected payable was not found.');
    err.statusCode = 404;
    err.code = 'BILL_NOT_FOUND';
    throw err;
  }

  if (Number(bill.supplier_id) !== Number(supplierId)) {
    const err = new Error('The selected payable belongs to a different supplier.');
    err.statusCode = 400;
    err.code = 'BILL_SUPPLIER_MISMATCH';
    throw err;
  }

  if (bill.status === 'Void') {
    const err = new Error('Cannot receive goods against a voided payable.');
    err.statusCode = 400;
    err.code = 'BILL_VOID';
    throw err;
  }

  return bill;
}

/**
 * Computes scheduled cheque amounts for a list of bills.
 */
async function getScheduledAmounts(executor, billIds) {
  if (!billIds || billIds.length === 0) return new Map();
  const { rows } = await executor.query(
    `SELECT apa.bill_id, COALESCE(SUM(apa.amount_allocated), 0) AS scheduled_amount
     FROM ap_payment_allocation apa
     JOIN ap_payment ap ON ap.payment_id = apa.payment_id
     LEFT JOIN cheque_records cr ON cr.id = ap.cheque_record_id
     WHERE apa.bill_id = ANY($1)
       AND ap.pdc_status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'BOUNCED', 'STALE')
       AND (cr.id IS NULL OR cr.status NOT IN ('VOID', 'REPLACED', 'DELETED'))
     GROUP BY apa.bill_id`,
    [billIds],
  );
  return new Map(rows.map((r) => [Number(r.bill_id), Number(r.scheduled_amount) || 0]));
}

/**
 * Resolves exact, similar, and legacy candidate bills for a supplier document reference.
 */
async function resolveDocumentMatches(executor, { supplierId, documentType = null, documentNo }) {
  if (!supplierId || !documentNo) {
    return { exact: [], similar: [], legacy: [] };
  }

  const normalizedKey = normalizeDocumentKey(documentNo);
  if (!normalizedKey) {
    return { exact: [], similar: [], legacy: [] };
  }

  // 1. Exact matches: active identity with same supplier, document_type, and normalized_key
  const { rows: exactRows } = await executor.query(
    `SELECT sb.bill_id, sb.bill_number, sb.bill_date, sb.due_date, sb.total_amount, sb.amount_paid,
            sb.status, sb.liability_basis, sb.supplier_document_type, sb.supplier_document_no,
            id.identity_id, id.document_type AS matched_doc_type, id.document_no AS matched_doc_no,
            'exact' AS match_reason
     FROM supplier_bill_document_identity id
     JOIN supplier_bill sb ON sb.bill_id = id.bill_id
     WHERE id.supplier_id = $1
       AND ($2::text IS NULL OR id.document_type = $2 OR id.document_type = 'other')
       AND id.normalized_key = $3
       AND id.status = 'active'
       AND sb.status <> 'Void'`,
    [supplierId, documentType, normalizedKey],
  );

  // 2. Similar matches: active identity with same supplier and normalized_key but different document_type
  const { rows: similarRows } = await executor.query(
    `SELECT sb.bill_id, sb.bill_number, sb.bill_date, sb.due_date, sb.total_amount, sb.amount_paid,
            sb.status, sb.liability_basis, sb.supplier_document_type, sb.supplier_document_no,
            id.identity_id, id.document_type AS matched_doc_type, id.document_no AS matched_doc_no,
            'different_document_type' AS match_reason
     FROM supplier_bill_document_identity id
     JOIN supplier_bill sb ON sb.bill_id = id.bill_id
     WHERE id.supplier_id = $1
       AND $2::text IS NOT NULL AND id.document_type <> $2 AND id.document_type <> 'other'
       AND id.normalized_key = $3
       AND id.status = 'active'
       AND sb.status <> 'Void'`,
    [supplierId, documentType, normalizedKey],
  );

  // 3. Legacy matches: bill_number matches documentNo directly
  const exactBillIds = new Set(exactRows.map((r) => r.bill_id));
  const similarBillIds = new Set(similarRows.map((r) => r.bill_id));

  const { rows: legacyRows } = await executor.query(
    `SELECT sb.bill_id, sb.bill_number, sb.bill_date, sb.due_date, sb.total_amount, sb.amount_paid,
            sb.status, sb.liability_basis, sb.supplier_document_type, sb.supplier_document_no,
            NULL::int AS identity_id, COALESCE(sb.supplier_document_type, 'legacy') AS matched_doc_type,
            COALESCE(sb.supplier_document_no, sb.bill_number) AS matched_doc_no,
            'legacy_bill_number' AS match_reason
     FROM supplier_bill sb
     WHERE sb.supplier_id = $1
       AND (supplier_bill_match_key(sb.supplier_document_no) = $2
            OR (sb.supplier_document_no IS NULL AND sb.bill_number NOT LIKE 'BILL-%'
                AND supplier_bill_match_key(sb.bill_number) = $2))
       AND sb.status <> 'Void'`,
    [supplierId, normalizedKey],
  );

  const filteredLegacy = legacyRows.filter(
    (r) => !exactBillIds.has(r.bill_id) && !similarBillIds.has(r.bill_id),
  );

  // Collect all unique bill IDs to enrich with scheduled amounts and receipt metadata
  const allBills = [...exactRows, ...similarRows, ...filteredLegacy];
  const allBillIds = allBills.map((b) => b.bill_id);

  if (allBillIds.length === 0) {
    return { exact: [], similar: [], legacy: [] };
  }

  const scheduledMap = await getScheduledAmounts(executor, allBillIds);

  const { rows: receipts } = await executor.query(
    `SELECT gr.bill_id, gr.grn_id, gr.grn_number, gr.receipt_date, gr.status, gr.workflow_status,
            gr.supplier_invoice_no, gr.physical_receipt_no, gr.supplier_document_no
     FROM goods_receipt gr
     WHERE gr.bill_id = ANY($1)
       AND gr.status <> 'Voided' AND gr.workflow_status <> 'Cancelled'
     ORDER BY gr.receipt_date DESC, gr.grn_id DESC`,
    [allBillIds],
  );

  const receiptsByBill = new Map();
  for (const r of receipts) {
    const list = receiptsByBill.get(r.bill_id) || [];
    list.push(r);
    receiptsByBill.set(r.bill_id, list);
  }

  const enrich = (bill) => {
    const total = Number(bill.total_amount) || 0;
    const paid = Number(bill.amount_paid) || 0;
    const outstanding = Math.max(0, total - paid);
    const scheduled = scheduledMap.get(bill.bill_id) || 0;
    const available = Math.max(0, outstanding - scheduled);
    return {
      ...bill,
      total_amount: total,
      amount_paid: paid,
      outstanding,
      scheduled_amount: scheduled,
      available_to_pay: available,
      existing_receipts: receiptsByBill.get(bill.bill_id) || [],
    };
  };

  return {
    exact: [...new Map(exactRows.map(b => [b.bill_id, b])).values()].map(enrich),
    similar: [...new Map(similarRows.filter(b => !exactBillIds.has(b.bill_id)).map(b => [b.bill_id, b])).values()].map(enrich),
    legacy: filteredLegacy.map(enrich),
  };
}

/**
 * Calculates net accepted goods value for active Posted receipts attached to a bill.
 */
async function getNetPostedGoodsValue(executor, billId) {
  const { rows: grns } = await executor.query(
    `SELECT grn_id, overall_discount_percent, overall_discount_amount
     FROM goods_receipt
     WHERE bill_id = $1 AND status = 'Active' AND workflow_status = 'Posted'
     ORDER BY grn_id ASC`,
    [billId],
  );

  let netGoodsTotal = 0;
  for (const gr of grns) {
    const { rows: lines } = await executor.query(
      `SELECT part_id, quantity, return_quantity, cost_price, line_discount_percent, line_discount_amount
       FROM goods_receipt_line
       WHERE grn_id = $1`,
      [gr.grn_id],
    );

    const costing = grnCosting.computeCosting({
      lines: lines.map((l) => ({
        part_id: l.part_id,
        quantity: l.quantity,
        return_quantity: l.return_quantity || 0,
        cost_price: l.cost_price,
        line_discount_percent: l.line_discount_percent,
        line_discount_amount: l.line_discount_amount,
      })),
      freightAmount: 0,
      overallDiscountPercent: gr.overall_discount_percent,
      overallDiscountAmount: gr.overall_discount_amount,
      recomputeSalePrice: false,
    });

    netGoodsTotal += costing.totals.net_goods_value || 0;
  }

  return {
    netGoodsTotal: Math.round(netGoodsTotal * 100) / 100,
    receiptCount: grns.length,
  };
}

/**
 * Audited bill amount and reference correction.
 */
async function recordBillAmountCorrection(client, {
  billId,
  newAmount,
  reason,
  actorId,
  confirmIndependent = false,
  documentType = null,
  documentNo = null,
}) {
  const { rows: [bill] } = await client.query(
    `SELECT bill_id, bill_number, supplier_id, total_amount, amount_paid, status,
            liability_basis, supplier_document_type, supplier_document_no
     FROM supplier_bill
     WHERE bill_id = $1
     FOR UPDATE`,
    [billId],
  );

  if (!bill) {
    const err = new Error('Payable not found.');
    err.statusCode = 404;
    throw err;
  }

  if (bill.status === 'Void') {
    const err = new Error('Cannot adjust a voided bill.');
    err.statusCode = 400;
    throw err;
  }

  if (bill.liability_basis === 'freight') {
    const err = new Error('Carrier freight bills cannot be modified via this correction endpoint.');
    err.statusCode = 400;
    throw err;
  }

  const amountPaid = Number(bill.amount_paid) || 0;
  const scheduledMap = await getScheduledAmounts(client, [billId]);
  const scheduledAmount = scheduledMap.get(billId) || 0;
  const minCommitted = amountPaid + scheduledAmount;

  const targetAmount = newAmount !== undefined && newAmount !== null
    ? Math.round(Number(newAmount) * 100) / 100
    : Number(bill.total_amount);

  if (targetAmount < minCommitted - 0.005) {
    const err = new Error(
      `New bill amount (₱${targetAmount.toFixed(2)}) cannot be less than committed payments (₱${minCommitted.toFixed(2)}).`,
    );
    err.statusCode = 400;
    throw err;
  }

  const oldAmount = Number(bill.total_amount);
  const delta = Math.round((targetAmount - oldAmount) * 100) / 100;

  if (delta !== 0) {
    await client.query('UPDATE supplier_bill SET total_amount = $1 WHERE bill_id = $2', [targetAmount, billId]);
    await apLedgerService.appendEntry(client, {
      supplierId: bill.supplier_id,
      billId,
      entryType: delta > 0 ? 'BILL_POSTED' : 'CREDIT_ADJUSTMENT',
      amount: delta,
      referenceNo: bill.bill_number,
      notes: reason || `Audited amount correction on bill ${bill.bill_number}`,
      createdBy: actorId,
    });
  }

  const oldDocType = bill.supplier_document_type;
  const oldDocNo = bill.supplier_document_no;
  const oldBasis = bill.liability_basis;

  let newDocType = documentType !== undefined ? (documentType || null) : oldDocType;
  let newDocNo = documentNo !== undefined ? (documentNo ? String(documentNo).trim() : null) : oldDocNo;
  let newBasis = oldBasis;

  if (confirmIndependent) {
    newBasis = 'independent';
  }

  if (newDocType && newDocNo) {
    await registerBillIdentity(client, {
      billId,
      supplierId: bill.supplier_id,
      documentType: newDocType,
      documentNo: newDocNo,
      isPrimary: true,
    });
  }

  await client.query(
    `UPDATE supplier_bill
     SET total_amount = $1,
         liability_basis = $2,
         supplier_document_type = $3,
         supplier_document_no = $4
     WHERE bill_id = $5`,
    [targetAmount, newBasis, newDocType, newDocNo, billId],
  );

  await client.query(
    `INSERT INTO supplier_bill_correction_log
       (bill_id, actor_id, correction_type, old_total_amount, new_total_amount,
        old_document_type, new_document_type, old_document_no, new_document_no,
        old_basis, new_basis, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      billId,
      actorId,
      confirmIndependent ? 'CONFIRM_INDEPENDENT_INVOICE' : 'AMOUNT_AND_REFERENCE_CORRECTION',
      oldAmount,
      targetAmount,
      oldDocType,
      newDocType,
      oldDocNo,
      newDocNo,
      oldBasis,
      newBasis,
      reason || 'Correction requested',
    ],
  );

  return {
    bill_id: billId,
    total_amount: targetAmount,
    amount_paid: amountPaid,
    liability_basis: newBasis,
    supplier_document_type: newDocType,
    supplier_document_no: newDocNo,
  };
}

module.exports = {
  assertBillReferenceAvailable,
  normalizeDocumentKey,
  registerBillIdentity,
  releaseBillIdentities,
  validateBillForReceiving,
  getScheduledAmounts,
  resolveDocumentMatches,
  getNetPostedGoodsValue,
  recordBillAmountCorrection,
};
