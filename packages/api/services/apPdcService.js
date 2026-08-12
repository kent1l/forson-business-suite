'use strict';

const apLedgerService = require('./apLedgerService');
const { computePdcMaturity } = require('./pdcService');

/**
 * Read PDC_STALE_DAYS / PDC_MAX_BOUNCE_ATTEMPTS from the settings table.
 */
async function getPdcSettings(db) {
  const { rows } = await db.query(
    `SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('PDC_STALE_DAYS', 'PDC_MAX_BOUNCE_ATTEMPTS')`
  );
  const map = rows.reduce((acc, r) => { acc[r.setting_key] = r.setting_value; return acc; }, {});
  return {
    staleDays: parseInt(map.PDC_STALE_DAYS || '180', 10),
    maxBounceAttempts: parseInt(map.PDC_MAX_BOUNCE_ATTEMPTS || '2', 10),
  };
}

/**
 * Record an audit log entry in cheque_clearance_log for an outbound cheque.
 */
async function logOutboundClearanceEvent(client, {
  apPaymentId = null,
  chequeRecordId = null,
  supplierId = null,
  bankAccountId = null,
  action,
  attemptNumber = 1,
  bounceReason = null,
  bounceFee = 0,
  notes = null,
  createdBy = null
}) {
  try {
    await client.query(
      `INSERT INTO cheque_clearance_log (
        cheque_type, ap_payment_id, cheque_record_id, supplier_id, bank_account_id,
        action, attempt_number, bounce_reason, bounce_fee, notes, created_by
      ) VALUES ('OUTBOUND_SUPPLIER', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [apPaymentId, chequeRecordId, supplierId, bankAccountId, action, attemptNumber, bounceReason, bounceFee, notes, createdBy]
    );
  } catch (err) {
    console.error('Failed to write outbound cheque_clearance_log:', err.message);
  }
}

/**
 * Issue a new outbound cheque. Branches on purposeType:
 *  - SUPPLIER_PAYMENT: creates ap_payment + ap_payment_allocation rows against billIds
 *  - LOAN_PAYMENT / RENT / OTHER_EXPENSE: creates an expense row (reusing the expense module)
 * Either way, inserts one cheque_records row as the physical instrument of record,
 * with a unique (bank_account_id, cheque_number) so the same number can never be
 * recorded twice against one account.
 *
 * @param {import('pg').PoolClient} client
 */
async function issueOutboundCheque(client, {
  bankAccountId,
  chequeNumber,
  chequeDate,
  purposeType,
  amount,
  payee,
  memo = null,
  templateId = null,
  supplierId = null,
  billIds = [],
  expenseCategoryId = null,
  referenceNumber = null,
  employeeId = null,
  userId = null,
}) {
  if (!['SUPPLIER_PAYMENT', 'LOAN_PAYMENT', 'RENT', 'OTHER_EXPENSE'].includes(purposeType)) {
    throw new Error(`Invalid purpose_type: ${purposeType}`);
  }

  let apPaymentId = null;
  let expenseId = null;

  if (purposeType === 'SUPPLIER_PAYMENT') {
    if (!supplierId) throw new Error('supplierId is required for SUPPLIER_PAYMENT cheques');

    const { rows: [payment] } = await client.query(
      `INSERT INTO ap_payment
         (supplier_id, employee_id, amount, method_id, reference_number, notes,
          pdc_status, cheque_date, bank_account_id, created_by)
       SELECT $1, $2, $3, pm.method_id, $4, $5, 'ISSUED', $6, $7, $8
       FROM payment_methods pm
       WHERE pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc')
       LIMIT 1
       RETURNING payment_id`,
      [supplierId, employeeId, amount, referenceNumber, memo, chequeDate, bankAccountId, userId]
    );
    if (!payment) throw new Error('No cheque-type payment method configured');
    apPaymentId = payment.payment_id;

    if (billIds.length > 0) {
      const { rows: bills } = await client.query(
        `SELECT bill_id, total_amount, amount_paid FROM supplier_bill WHERE bill_id = ANY($1::int[]) FOR UPDATE`,
        [billIds]
      );
      const remainingAmount = { amount };
      for (const bill of bills) {
        const owed = parseFloat(bill.total_amount) - parseFloat(bill.amount_paid);
        const allocate = Math.min(owed, remainingAmount.amount);
        if (allocate <= 0) continue;
        await client.query(
          `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
          [apPaymentId, bill.bill_id, allocate]
        );
        remainingAmount.amount -= allocate;
      }
    }
  } else {
    if (!expenseCategoryId) throw new Error('expenseCategoryId is required for non-supplier outbound cheques');

    const { rows: [expense] } = await client.query(
      `INSERT INTO expense
         (expense_date, category_id, amount, payee, payment_method_text, reference_no, notes, created_by)
       VALUES ($1, $2, $3, $4, 'Cheque', $5, $6, $7)
       RETURNING expense_id`,
      [chequeDate, expenseCategoryId, amount, payee, referenceNumber, memo, userId]
    );
    expenseId = expense.expense_id;
  }

  const { rows: [chequeRecord] } = await client.query(
    `INSERT INTO cheque_records
       (template_id, payee, amount, cheque_date, memo, bank_account_id, cheque_number,
        status, purpose_type, ap_payment_id, expense_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9, $10)
     RETURNING id`,
    [templateId, payee, amount, chequeDate, memo, bankAccountId, chequeNumber, purposeType, apPaymentId, expenseId]
  );

  if (apPaymentId) {
    await client.query(`UPDATE ap_payment SET cheque_record_id = $1 WHERE payment_id = $2`, [chequeRecord.id, apPaymentId]);
  }

  return { chequeRecordId: chequeRecord.id, apPaymentId, expenseId };
}

/**
 * Fetch outbound cheques for the Treasury Desk. SUPPLIER_PAYMENT rows are joined
 * against ap_payment/supplier; non-AP rows (loan/rent/other) are joined against
 * cheque_records + expense directly since they have no ap_payment counterpart.
 */
async function getOutboundClearanceList(db, pdcStatusFilter = null, maturityFilter = null) {
  const validStatuses = new Set(['ALL', 'ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOID', 'STALE', 'REPLACED']);
  if (pdcStatusFilter && !validStatuses.has(pdcStatusFilter)) {
    throw new Error(`Invalid pdc_status filter: ${pdcStatusFilter}`);
  }
  const statusConditions = pdcStatusFilter && pdcStatusFilter !== 'ALL'
    ? `AND cr.status = '${pdcStatusFilter.replace(/'/g, "''")}'`
    : `AND cr.status NOT IN ('VOID')`;

  const query = `
    SELECT
      cr.id                                     AS cheque_record_id,
      cr.ap_payment_id                          AS payment_id,
      cr.expense_id,
      cr.purpose_type,
      cr.bank_account_id,
      ba.account_name                           AS bank_account_name,
      cr.template_id,
      cr.cheque_number,
      cr.cheque_date,
      cr.amount,
      cr.payee,
      cr.status                                 AS pdc_status,
      cr.memo,
      cr.replaces_cheque_id,
      cr.replaced_by_cheque_id,
      cr.created_at,
      s.supplier_id,
      s.supplier_name                           AS company_name,
      COALESCE(bounce_agg.bounce_count, 0)::int AS bounce_count
    FROM cheque_records cr
    LEFT JOIN bank_account ba ON ba.bank_account_id = cr.bank_account_id
    LEFT JOIN ap_payment ap ON ap.payment_id = cr.ap_payment_id
    LEFT JOIN supplier s ON s.supplier_id = ap.supplier_id
    LEFT JOIN (
      SELECT cheque_record_id, COUNT(*)::int AS bounce_count
      FROM cheque_clearance_log
      WHERE action = 'BOUNCED' AND cheque_type = 'OUTBOUND_SUPPLIER'
      GROUP BY cheque_record_id
    ) bounce_agg ON bounce_agg.cheque_record_id = cr.id
    WHERE cr.is_deleted = false
      AND (cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL)
      ${statusConditions}
    ORDER BY cr.created_at DESC
  `;

  const { rows } = await db.query(query);
  const { staleDays } = await getPdcSettings(db);
  const combined = rows.map(r => computePdcMaturity(r, staleDays));

  if (maturityFilter && maturityFilter !== 'ALL') {
    return combined.filter(r => r.maturity_status === maturityFilter);
  }
  return combined;
}

/**
 * Verify and clear an outbound cheque (bank has honored it).
 */
async function verifyOutboundPayment(client, { chequeRecordId, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, purpose_type, amount, cheque_number, bank_account_id
     FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw new Error(`Cheque record #${chequeRecordId} not found`);

  await client.query(`UPDATE cheque_records SET status = 'CLEARED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(
      `SELECT payment_id, supplier_id, amount, reference_number FROM ap_payment WHERE payment_id = $1 FOR UPDATE OF ap_payment`,
      [cr.ap_payment_id]
    );
    supplierId = ap.supplier_id;

    await client.query(`UPDATE ap_payment SET pdc_status = 'CLEARED' WHERE payment_id = $1`, [cr.ap_payment_id]);

    await apLedgerService.appendEntry(client, {
      supplierId: ap.supplier_id,
      paymentId: ap.payment_id,
      entryType: 'PAYMENT_SETTLED',
      amount: -parseFloat(ap.amount),
      paymentChannel: 'cheque',
      referenceNo: ap.reference_number || cr.cheque_number,
      notes: `Outbound cheque #${cr.cheque_number || cr.id} cleared`,
      createdBy: userId,
    });

    const allocRes = await client.query(
      `SELECT apa.bill_id, SUM(apa.amount_allocated) AS allocated, sb.total_amount
       FROM ap_payment_allocation apa
       JOIN supplier_bill sb ON sb.bill_id = apa.bill_id
       WHERE apa.payment_id = $1
       GROUP BY apa.bill_id, sb.total_amount`,
      [cr.ap_payment_id]
    );
    for (const alloc of allocRes.rows) {
      const totalAllocated = parseFloat(alloc.allocated);
      const billTotal = parseFloat(alloc.total_amount);
      const newStatus = totalAllocated >= billTotal ? 'Paid' : 'Partially Paid';
      await client.query(
        `UPDATE supplier_bill SET status = $1, amount_paid = $2 WHERE bill_id = $3`,
        [newStatus, totalAllocated, alloc.bill_id]
      );
    }
  }

  await logOutboundClearanceEvent(client, {
    apPaymentId: cr.ap_payment_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'CLEARED',
    notes: 'Outbound cheque verified and cleared via Treasury Desk',
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, apPaymentId: cr.ap_payment_id, pdc_status: 'CLEARED' };
}

/**
 * Process a bounced/dishonored outbound cheque: reverses the underlying bill status
 * (the liability is still owed — only the instrument failed), posts an AP ledger
 * reversal + optional bank fee, and places the supplier on payment hold.
 */
async function processBouncedOutboundCheque(client, { chequeRecordId, bounceFee = 0, reason = null, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, purpose_type, amount, cheque_number, bank_account_id
     FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw new Error(`Cheque record #${chequeRecordId} not found`);

  const parsedFee = parseFloat(bounceFee) || 0;
  const refNo = cr.cheque_number || `CR#${cr.id}`;

  const bounceRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM cheque_clearance_log WHERE cheque_record_id = $1 AND action = 'BOUNCED'`,
    [chequeRecordId]
  );
  const attemptNumber = (bounceRes.rows[0]?.count || 0) + 1;

  await client.query(`UPDATE cheque_records SET status = 'BOUNCED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(
      `SELECT payment_id, supplier_id FROM ap_payment WHERE payment_id = $1 FOR UPDATE`,
      [cr.ap_payment_id]
    );
    supplierId = ap.supplier_id;

    await client.query(`UPDATE ap_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`, [cr.ap_payment_id]);

    // Reverse bill statuses back down (the bill is still owed)
    const allocRes = await client.query(
      `SELECT apa.bill_id, sb.total_amount,
              COALESCE(other_alloc.total_other, 0) AS other_allocated
       FROM ap_payment_allocation apa
       JOIN supplier_bill sb ON sb.bill_id = apa.bill_id
       LEFT JOIN (
         SELECT a2.bill_id, SUM(a2.amount_allocated) AS total_other
         FROM ap_payment_allocation a2
         WHERE a2.payment_id != $1
         GROUP BY a2.bill_id
       ) other_alloc ON other_alloc.bill_id = apa.bill_id
       WHERE apa.payment_id = $1`,
      [cr.ap_payment_id]
    );
    for (const alloc of allocRes.rows) {
      const otherPaid = parseFloat(alloc.other_allocated);
      const billTotal = parseFloat(alloc.total_amount);
      const newStatus = otherPaid >= billTotal ? 'Paid' : otherPaid > 0 ? 'Partially Paid' : 'Unpaid';
      await client.query(
        `UPDATE supplier_bill SET status = $1, amount_paid = $2 WHERE bill_id = $3`,
        [newStatus, otherPaid, alloc.bill_id]
      );
    }

    await apLedgerService.appendEntry(client, {
      supplierId,
      paymentId: ap.payment_id,
      entryType: 'PDC_BOUNCED_REVERSAL',
      amount: parseFloat(cr.amount),
      referenceNo: refNo,
      notes: reason || `Bounced outbound cheque reversal for ${refNo} (Attempt #${attemptNumber})`,
      createdBy: userId,
    });

    if (parsedFee > 0) {
      await apLedgerService.appendEntry(client, {
        supplierId,
        paymentId: ap.payment_id,
        entryType: 'BOUNCE_FEE_PENALTY',
        amount: parsedFee,
        referenceNo: refNo,
        notes: `Bank penalty fee for bounced outbound cheque ${refNo}`,
        createdBy: userId,
      });
    }

    const holdReason = `Bounced Outbound Cheque ${refNo} (Attempt #${attemptNumber})${reason ? ': ' + reason : ''}`;
    await client.query(
      `UPDATE supplier SET payment_hold = true, payment_hold_reason = $1 WHERE supplier_id = $2`,
      [holdReason, supplierId]
    );
  }

  await logOutboundClearanceEvent(client, {
    apPaymentId: cr.ap_payment_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'BOUNCED',
    attemptNumber,
    bounceReason: reason || 'NSF / Insufficient Funds',
    bounceFee: parsedFee,
    notes: reason,
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, apPaymentId: cr.ap_payment_id, bounceAttempt: attemptNumber, bounceFee: parsedFee };
}

/**
 * Re-deposit / re-present a previously bounced outbound cheque.
 */
async function redepositOutboundCheque(client, { chequeRecordId, liftPaymentHold = false, notes = null, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, status, bank_account_id, cheque_number FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw new Error(`Cheque record #${chequeRecordId} not found`);
  if (cr.status !== 'BOUNCED') {
    throw new Error(`Only bounced cheques can be re-deposited. Current status: ${cr.status}`);
  }

  const prevRes = await client.query(
    `SELECT COUNT(*)::int AS count FROM cheque_clearance_log WHERE cheque_record_id = $1 AND action IN ('BOUNCED', 'REDEPOSITED')`,
    [chequeRecordId]
  );
  const attemptNumber = (prevRes.rows[0]?.count || 0) + 1;

  await client.query(`UPDATE cheque_records SET status = 'DEPOSITED', updated_at = now() WHERE id = $1`, [chequeRecordId]);

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(`SELECT supplier_id FROM ap_payment WHERE payment_id = $1`, [cr.ap_payment_id]);
    supplierId = ap.supplier_id;
    await client.query(`UPDATE ap_payment SET pdc_status = 'DEPOSITED' WHERE payment_id = $1`, [cr.ap_payment_id]);
    if (liftPaymentHold) {
      await client.query(`UPDATE supplier SET payment_hold = false, payment_hold_reason = NULL WHERE supplier_id = $1`, [supplierId]);
    }
  }

  await logOutboundClearanceEvent(client, {
    apPaymentId: cr.ap_payment_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'REDEPOSITED',
    attemptNumber,
    notes: notes || `Re-presented for bank clearance (Attempt #${attemptNumber})`,
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, pdc_status: 'DEPOSITED', attemptNumber, liftedPaymentHold: liftPaymentHold };
}

/**
 * Void a cheque that was written incorrectly and never actually handed over
 * (spoiled before issuance). Cancels any linked ap_payment/expense so nothing is
 * left as a phantom liability, and keeps the cheque-number sequence explainable.
 */
async function voidCheque(client, { chequeRecordId, reason, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT id, ap_payment_id, expense_id, status, bank_account_id FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw new Error(`Cheque record #${chequeRecordId} not found`);
  if (['CLEARED', 'VOID', 'REPLACED'].includes(cr.status)) {
    throw new Error(`Cannot void a cheque with status ${cr.status}`);
  }

  await client.query(
    `UPDATE cheque_records SET status = 'VOID', is_void = true, voided_by = $1, voided_at = now(), void_reason = $2 WHERE id = $3`,
    [userId, reason, chequeRecordId]
  );

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(`SELECT supplier_id FROM ap_payment WHERE payment_id = $1`, [cr.ap_payment_id]);
    supplierId = ap?.supplier_id || null;
    await client.query(`UPDATE ap_payment SET pdc_status = 'REPLACED' WHERE payment_id = $1`, [cr.ap_payment_id]);
    // Bills funded by a voided cheque were never actually paid — no ledger entry was
    // posted at issuance time (only at clearance), so there is nothing to reverse.
  }
  if (cr.expense_id) {
    await client.query(
      `UPDATE expense SET is_void = true, voided_by = $1, voided_at = now(), void_reason = $2 WHERE expense_id = $3`,
      [userId, reason, cr.expense_id]
    );
  }

  await logOutboundClearanceEvent(client, {
    apPaymentId: cr.ap_payment_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'VOID',
    notes: reason,
    createdBy: userId,
  });

  return { chequeRecordId: cr.id, status: 'VOID' };
}

/**
 * Replace a cheque that is no longer usable after issuance (gone stale, or bounced
 * past the configured attempt limit). The original cheque_records row is marked
 * REPLACED; a new cheque_records row (and a new ap_payment/expense carrying the
 * same underlying obligation forward) is created and linked in both directions,
 * so the audit trail runs continuously from "bill still needs paying" through the
 * failed instrument to the successful one.
 */
async function replaceCheque(client, { chequeRecordId, newChequeNumber, newChequeDate, newBankAccountId = null, reason = null, userId = null }) {
  const { rows: [cr] } = await client.query(
    `SELECT * FROM cheque_records WHERE id = $1 FOR UPDATE`,
    [chequeRecordId]
  );
  if (!cr) throw new Error(`Cheque record #${chequeRecordId} not found`);
  if (!['BOUNCED', 'STALE'].includes(cr.status)) {
    throw new Error(`Only bounced or stale cheques can be replaced. Current status: ${cr.status}`);
  }

  const bankAccountId = newBankAccountId || cr.bank_account_id;
  let newApPaymentId = null;
  let newExpenseId = null;

  if (cr.ap_payment_id) {
    const { rows: [oldAp] } = await client.query(`SELECT * FROM ap_payment WHERE payment_id = $1`, [cr.ap_payment_id]);
    const { rows: [newAp] } = await client.query(
      `INSERT INTO ap_payment (supplier_id, employee_id, amount, method_id, reference_number, notes,
                                pdc_status, cheque_date, bank_account_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED', $7, $8, $9)
       RETURNING payment_id`,
      [oldAp.supplier_id, oldAp.employee_id, oldAp.amount, oldAp.method_id, newChequeNumber,
       `Replacement for cheque ${cr.cheque_number || cr.id}: ${reason || ''}`, newChequeDate, bankAccountId, userId]
    );
    newApPaymentId = newAp.payment_id;

    const { rows: origAllocs } = await client.query(
      `SELECT bill_id, amount_allocated FROM ap_payment_allocation WHERE payment_id = $1`, [cr.ap_payment_id]
    );
    for (const alloc of origAllocs) {
      await client.query(
        `INSERT INTO ap_payment_allocation (payment_id, bill_id, amount_allocated) VALUES ($1, $2, $3)`,
        [newApPaymentId, alloc.bill_id, alloc.amount_allocated]
      );
    }
    await client.query(`UPDATE ap_payment SET pdc_status = 'REPLACED' WHERE payment_id = $1`, [cr.ap_payment_id]);
  } else if (cr.expense_id) {
    const { rows: [oldExp] } = await client.query(`SELECT * FROM expense WHERE expense_id = $1`, [cr.expense_id]);
    const { rows: [newExp] } = await client.query(
      `INSERT INTO expense (expense_date, category_id, amount, payee, payment_method_text, reference_no, notes, created_by)
       VALUES ($1, $2, $3, $4, 'Cheque', $5, $6, $7)
       RETURNING expense_id`,
      [newChequeDate, oldExp.category_id, oldExp.amount, oldExp.payee, newChequeNumber,
       `Replacement for cheque ${cr.cheque_number || cr.id}: ${reason || ''}`, userId]
    );
    newExpenseId = newExp.expense_id;
  }

  const { rows: [newCr] } = await client.query(
    `INSERT INTO cheque_records
       (template_id, payee, amount, cheque_date, memo, bank_account_id, cheque_number,
        status, purpose_type, ap_payment_id, expense_id, replaces_cheque_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9, $10, $11)
     RETURNING id`,
    [cr.template_id, cr.payee, cr.amount, newChequeDate, cr.memo, bankAccountId, newChequeNumber,
     cr.purpose_type, newApPaymentId, newExpenseId, cr.id]
  );

  if (newApPaymentId) {
    await client.query(`UPDATE ap_payment SET cheque_record_id = $1 WHERE payment_id = $2`, [newCr.id, newApPaymentId]);
  }

  await client.query(
    `UPDATE cheque_records SET status = 'REPLACED', replaced_by_cheque_id = $1 WHERE id = $2`,
    [newCr.id, cr.id]
  );

  let supplierId = null;
  if (cr.ap_payment_id) {
    const { rows: [ap] } = await client.query(`SELECT supplier_id FROM ap_payment WHERE payment_id = $1`, [cr.ap_payment_id]);
    supplierId = ap?.supplier_id || null;
  }

  await logOutboundClearanceEvent(client, {
    apPaymentId: cr.ap_payment_id,
    chequeRecordId: cr.id,
    supplierId,
    bankAccountId: cr.bank_account_id,
    action: 'REPLACED',
    notes: `Replaced by cheque #${newChequeNumber} (record #${newCr.id}): ${reason || ''}`,
    createdBy: userId,
  });

  return { oldChequeRecordId: cr.id, newChequeRecordId: newCr.id, newApPaymentId, newExpenseId };
}

async function getOutboundClearanceHistory(db, chequeRecordId) {
  const { rows } = await db.query(
    `SELECT l.log_id, l.cheque_type, l.cheque_record_id, l.ap_payment_id, l.action,
            l.attempt_number, l.bounce_reason, l.bounce_fee, l.notes, l.created_at, l.created_by,
            u.username AS created_by_username
     FROM cheque_clearance_log l
     LEFT JOIN employee u ON u.employee_id = l.created_by
     WHERE l.cheque_record_id = $1 AND l.cheque_type = 'OUTBOUND_SUPPLIER'
     ORDER BY l.created_at ASC`,
    [chequeRecordId]
  );
  return rows;
}

async function getOutboundPdcSummaryStats(db) {
  const query = `
    SELECT
      COUNT(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE') THEN 1 END)::int AS held_for_release_count,
      COALESCE(SUM(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE') THEN cr.amount ELSE 0 END), 0) AS held_for_release_total,
      COUNT(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED') AND cr.cheque_date <= CURRENT_DATE THEN 1 END)::int AS due_today_count,
      COALESCE(SUM(CASE WHEN cr.status IN ('ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED') AND cr.cheque_date <= CURRENT_DATE THEN cr.amount ELSE 0 END), 0) AS due_today_total,
      COALESCE(SUM(CASE WHEN cr.status = 'CLEARED' AND DATE_TRUNC('month', cr.updated_at) = DATE_TRUNC('month', CURRENT_DATE) THEN cr.amount ELSE 0 END), 0) AS cleared_month_total,
      COUNT(CASE WHEN cr.status = 'BOUNCED' THEN 1 END)::int AS bounced_count,
      COALESCE(SUM(CASE WHEN cr.status = 'BOUNCED' THEN cr.amount ELSE 0 END), 0) AS bounced_total
    FROM cheque_records cr
    WHERE cr.is_deleted = false AND cr.status != 'VOID'
      AND (cr.ap_payment_id IS NOT NULL OR cr.expense_id IS NOT NULL)
  `;
  const { rows } = await db.query(query);
  return rows[0] || {
    held_for_release_count: 0, held_for_release_total: 0,
    due_today_count: 0, due_today_total: 0,
    cleared_month_total: 0, bounced_count: 0, bounced_total: 0
  };
}

module.exports = {
  getPdcSettings,
  issueOutboundCheque,
  getOutboundClearanceList,
  verifyOutboundPayment,
  processBouncedOutboundCheque,
  redepositOutboundCheque,
  voidCheque,
  replaceCheque,
  getOutboundClearanceHistory,
  getOutboundPdcSummaryStats,
};
