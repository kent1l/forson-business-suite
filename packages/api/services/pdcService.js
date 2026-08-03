'use strict';

const arLedgerService = require('./arLedgerService');

/**
 * Calculate dynamic maturity details for PDC cheques based on cheque_date vs current date.
 * @param {object} row
 */
function computePdcMaturity(row) {
  const todayStr = new Date().toISOString().split('T')[0];
  const chequeDateStr = row.cheque_date || (row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : todayStr);

  const today = new Date(todayStr);
  const chequeDate = new Date(chequeDateStr);
  const diffMs = chequeDate - today;
  const daysDiff = Math.round(diffMs / (1000 * 60 * 60 * 24));

  let maturity_status = 'DUE_TODAY';
  let maturity_label = 'Due for Clearance';

  if (daysDiff < -180) {
    maturity_status = 'STALE_CHEQUE';
    maturity_label = 'Stale Cheque (> 180 Days Old)';
  } else if (daysDiff > 0) {
    maturity_status = 'FUTURE_PDC';
    maturity_label = `Future PDC (Matures in ${daysDiff} day${daysDiff === 1 ? '' : 's'})`;
  } else if (daysDiff === 0) {
    maturity_status = 'DUE_TODAY';
    maturity_label = 'Matures Today';
  } else {
    maturity_status = 'DUE_TODAY';
    maturity_label = 'Matured / Ready for Clearance';
  }

  return {
    ...row,
    cheque_date: chequeDateStr,
    maturity_status,
    maturity_label,
    days_until_maturity: daysDiff
  };
}

/**
 * Fetch pending payments across channels for Collections & Clearance Desk.
 *
 * PRIMARY source: customer_payment (one row per physical cheque/payment instrument).
 * LEGACY source:  invoice_payments with pdc_status NOT IN ('CLEARED') for backward compat
 *                 with rows created before this refactor.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} [pdcStatusFilter]
 * @param {string} [maturityFilter] - 'ALL', 'DUE_TODAY', 'FUTURE_PDC', 'STALE_CHEQUE'
 */
async function getCollectionsClearanceList(db, pdcStatusFilter = null, maturityFilter = null) {
  // Build WHERE clause for pdc_status filter
  const statusConditions = pdcStatusFilter && pdcStatusFilter !== 'ALL'
    ? `AND pdc_status = '${pdcStatusFilter.replace(/'/g, "''")}'`  // safe: validated below
    : `AND pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED')`;

  const validStatuses = new Set(['ALL', 'RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED']);
  if (pdcStatusFilter && !validStatuses.has(pdcStatusFilter)) {
    throw new Error(`Invalid pdc_status filter: ${pdcStatusFilter}`);
  }

  // ── PRIMARY: customer_payment rows (new AR receipt flow) ─────────────────
  // Each row represents ONE physical payment instrument (cheque, bank transfer, etc.)
  // CRITICAL: filter to cheque-type methods only. Cash/instant payments are
  // settled at time of receipt — they must never appear in the PDC/Clearance Desk.
  // A payment is a "PDC/cheque" if: method type = 'cheque', OR the pdc_status
  // was explicitly set to RECEIVED/HELD/DEPOSITED/BOUNCED (deferred handling).
  const cpQuery = `
    SELECT
      cp.payment_id,
      'customer_payment'                        AS source_table,
      NULL::integer                             AS invoice_id,
      STRING_AGG(i.invoice_number, ', ' ORDER BY i.invoice_number) AS invoice_number,
      cp.customer_id,
      c.company_name,
      c.first_name,
      c.last_name,
      cp.amount                                 AS amount,
      cp.pdc_status,
      cp.method_id                              AS payment_method_id,
      pm.name                                   AS payment_method_name,
      pm.code                                   AS payment_method_code,
      cp.reference_number                       AS reference_number,
      cp.cheque_date                            AS cheque_date,
      cp.payment_date                           AS payment_date,
      cp.payment_date                           AS created_at,
      COALESCE(bounce_agg.bounce_count, 0)::int AS bounce_count,
      COUNT(DISTINCT ipa.invoice_id)::int       AS invoice_count
    FROM customer_payment cp
    JOIN customer c ON c.customer_id = cp.customer_id
    LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
    LEFT JOIN invoice_payment_allocation ipa ON ipa.payment_id = cp.payment_id
    LEFT JOIN invoice i ON i.invoice_id = ipa.invoice_id
    LEFT JOIN (
      SELECT customer_payment_id, COUNT(*)::int AS bounce_count
      FROM cheque_clearance_log
      WHERE action = 'BOUNCED' AND customer_payment_id IS NOT NULL
      GROUP BY customer_payment_id
    ) bounce_agg ON bounce_agg.customer_payment_id = cp.payment_id
    WHERE
      -- Only show deferred/cheque-type instruments, not instant cash/bank payments
      (pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc') OR
       cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'BOUNCED'))
      ${statusConditions.replace(/pdc_status/g, 'cp.pdc_status')}
    GROUP BY
      cp.payment_id, cp.customer_id, c.company_name, c.first_name, c.last_name,
      cp.amount, cp.pdc_status, cp.method_id, pm.name, pm.code,
      cp.reference_number, cp.cheque_date, cp.payment_date, bounce_agg.bounce_count
    ORDER BY cp.payment_date DESC
  `;

  // ── LEGACY: invoice_payments rows (pre-refactor PDC cheques) ─────────────
  // These rows were created by the old per-invoice payment flow.
  // Kept for backward compat so existing pending cheques remain visible.
  const ipStatusConditions = pdcStatusFilter && pdcStatusFilter !== 'ALL'
    ? `AND (ip.pdc_status = '${pdcStatusFilter.replace(/'/g, "''")}' OR (ip.payment_status = 'pending' AND '${pdcStatusFilter}' = 'RECEIVED'))`
    : `AND (ip.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'BOUNCED') OR ip.payment_status = 'pending')`;

  const ipQuery = `
    SELECT
      ip.payment_id,
      'invoice_payments'                        AS source_table,
      ip.invoice_id,
      i.invoice_number,
      i.customer_id,
      c.company_name,
      c.first_name,
      c.last_name,
      ip.amount_paid                            AS amount,
      COALESCE(ip.pdc_status, 'RECEIVED')       AS pdc_status,
      ip.method_id                              AS payment_method_id,
      pm.name                                   AS payment_method_name,
      pm.code                                   AS payment_method_code,
      ip.reference                              AS reference_number,
      ip.metadata->>'cheque_date'              AS cheque_date,
      ip.created_at                             AS payment_date,
      ip.created_at                             AS created_at,
      COALESCE(bounce_agg.bounce_count, 0)::int AS bounce_count,
      1::int                                    AS invoice_count
    FROM invoice_payments ip
    JOIN invoice i ON i.invoice_id = ip.invoice_id
    JOIN customer c ON c.customer_id = i.customer_id
    LEFT JOIN payment_methods pm ON pm.method_id = ip.method_id
    LEFT JOIN (
      SELECT payment_id, COUNT(*)::int AS bounce_count
      FROM cheque_clearance_log
      WHERE action = 'BOUNCED' AND customer_payment_id IS NULL
      GROUP BY payment_id
    ) bounce_agg ON bounce_agg.payment_id = ip.payment_id
    WHERE TRUE ${ipStatusConditions}
    ORDER BY ip.created_at DESC
  `;

  const [cpResult, ipResult] = await Promise.all([
    db.query(cpQuery),
    db.query(ipQuery),
  ]);

  const combined = [...(cpResult?.rows || []), ...(ipResult?.rows || [])].map(computePdcMaturity);

  // Sort combined result by created_at DESC
  combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (maturityFilter && maturityFilter !== 'ALL') {
    return combined.filter(r => r.maturity_status === maturityFilter);
  }

  return combined;
}

/**
 * Record an audit log entry in cheque_clearance_log.
 */
async function logChequeClearanceEvent(client, {
  chequeType = 'INBOUND_CUSTOMER',
  paymentId = null,           // invoice_payments.payment_id (legacy)
  customerPaymentId = null,   // customer_payment.payment_id (new)
  chequeRecordId = null,
  customerId = null,
  supplierId = null,
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
        cheque_type, payment_id, customer_payment_id, cheque_record_id, customer_id, supplier_id,
        action, attempt_number, bounce_reason, bounce_fee, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        chequeType, paymentId, customerPaymentId, chequeRecordId, customerId, supplierId,
        action, attemptNumber, bounceReason, bounceFee, notes, createdBy
      ]
    );
  } catch (err) {
    console.error('Failed to write cheque_clearance_log:', err.message);
  }
}

/**
 * Fetch full audit log history for a specific payment / cheque.
 * Supports both customer_payment (new) and invoice_payments (legacy) IDs.
 */
async function getChequeClearanceHistory(db, paymentId, sourceTable = 'auto') {
  let query;
  let params;

  if (sourceTable === 'customer_payment') {
    query = `
      SELECT l.log_id, l.cheque_type, l.customer_payment_id AS payment_id, l.action,
             l.attempt_number, l.bounce_reason, l.bounce_fee, l.notes, l.created_at, l.created_by,
             u.username AS created_by_username
      FROM cheque_clearance_log l
      LEFT JOIN users u ON u.user_id = l.created_by
      WHERE l.customer_payment_id = $1
      ORDER BY l.created_at ASC;
    `;
    params = [paymentId];
  } else {
    // Legacy invoice_payments or auto-detect
    query = `
      SELECT l.log_id, l.cheque_type, COALESCE(l.customer_payment_id, l.payment_id) AS payment_id,
             l.action, l.attempt_number, l.bounce_reason, l.bounce_fee, l.notes, l.created_at, l.created_by,
             u.username AS created_by_username
      FROM cheque_clearance_log l
      LEFT JOIN users u ON u.user_id = l.created_by
      WHERE l.payment_id = $1 OR l.customer_payment_id = $1
      ORDER BY l.created_at ASC;
    `;
    params = [paymentId];
  }

  const { rows } = await db.query(query, params);
  return rows;
}

/**
 * Verify and clear a pending payment/PDC.
 * Supports both customer_payment (new) and invoice_payments (legacy) records.
 *
 * For customer_payment: writes ONE ar_ledger PAYMENT_SETTLED entry for the full amount.
 * For invoice_payments (legacy): writes per-invoice ledger entry.
 *
 * @param {import('pg').PoolClient} client - Open transaction client
 * @param {object} params
 * @param {number} params.paymentId
 * @param {string} [params.sourceTable] - 'customer_payment' | 'invoice_payments' | 'auto'
 * @param {number} [params.userId]
 */
async function verifyPayment(client, { paymentId, sourceTable = 'auto', userId = null }) {
  // ── Detect source table if auto ─────────────────────────────────────────
  if (sourceTable === 'auto') {
    const cpCheck = await client.query(
      'SELECT payment_id FROM customer_payment WHERE payment_id = $1',
      [paymentId]
    );
    sourceTable = (cpCheck?.rows && cpCheck.rows.length > 0) ? 'customer_payment' : 'invoice_payments';
  }

  if (sourceTable === 'customer_payment') {
    // ── New flow: customer_payment ──────────────────────────────────────────
    const { rows: [cp] } = await client.query(
      `SELECT cp.payment_id, cp.customer_id, cp.amount, cp.pdc_status,
              cp.reference_number, cp.method_id, pm.code AS method_code, pm.name AS method_name
       FROM customer_payment cp
       LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
       WHERE cp.payment_id = $1
       FOR UPDATE OF cp`,
      [paymentId]
    );
    if (!cp) throw new Error(`Payment #${paymentId} not found in customer_payment`);

    // Mark as cleared
    await client.query(
      `UPDATE customer_payment SET pdc_status = 'CLEARED' WHERE payment_id = $1`,
      [paymentId]
    );

    // Write single AR ledger entry for the full cheque amount
    await arLedgerService.appendEntry(client, {
      customerId: cp.customer_id,
      paymentId: cp.payment_id,
      entryType: 'PAYMENT_SETTLED',
      amount: -parseFloat(cp.amount),
      paymentChannel: cp.method_code,
      referenceNo: cp.reference_number,
      notes: `Cheque cleared — ${cp.method_name || 'cheque'} #${cp.reference_number || cp.payment_id}`,
      createdBy: userId,
    });

    // Also mark all associated invoices as settled (update amount_paid / status)
    // using the invoice_payment_allocation totals
    const allocRes = await client.query(
      `SELECT ipa.invoice_id,
              SUM(ipa.amount_allocated) AS allocated,
              i.total_amount
       FROM invoice_payment_allocation ipa
       JOIN invoice i ON i.invoice_id = ipa.invoice_id
       WHERE ipa.payment_id = $1
       GROUP BY ipa.invoice_id, i.total_amount`,
      [paymentId]
    );
    const allocations = allocRes?.rows || [];
    for (const alloc of allocations) {
      const totalAllocated = parseFloat(alloc.allocated);
      const invoiceTotal = parseFloat(alloc.total_amount);
      const newStatus = totalAllocated >= invoiceTotal ? 'Paid' : 'Partially Paid';
      await client.query(
        'UPDATE invoice SET status = $1 WHERE invoice_id = $2',
        [newStatus, alloc.invoice_id]
      );
    }

    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      customerPaymentId: cp.payment_id,
      customerId: cp.customer_id,
      action: 'CLEARED',
      notes: 'Cheque verified and cleared via PDC desk',
      createdBy: userId
    });

    return {
      payment_id: cp.payment_id,
      source_table: 'customer_payment',
      customer_id: cp.customer_id,
      amount: cp.amount,
      pdc_status: 'CLEARED',
      invoice_count: allocations.length,
    };

  } else {
    // ── Legacy flow: invoice_payments ─────────────────────────────────────
    const { rows: [payment] } = await client.query(
      `SELECT ip.payment_id, ip.invoice_id, ip.amount_paid AS amount, ip.payment_status, ip.pdc_status, i.customer_id
       FROM invoice_payments ip
       JOIN invoice i ON i.invoice_id = ip.invoice_id
       WHERE ip.payment_id = $1 FOR UPDATE OF ip`,
      [paymentId]
    );
    if (!payment) throw new Error(`Payment #${paymentId} not found`);

    const { rows: [updated] } = await client.query(
      `UPDATE invoice_payments
       SET payment_status = 'settled', pdc_status = 'CLEARED'
       WHERE payment_id = $1
       RETURNING payment_id, invoice_id, amount_paid AS amount, payment_status, pdc_status`,
      [paymentId]
    );

    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      paymentId: payment.payment_id,
      customerId: payment.customer_id,
      action: 'CLEARED',
      notes: 'Payment verified and cleared',
      createdBy: userId
    });

    return { ...updated, source_table: 'invoice_payments' };
  }
}

/**
 * Automated processor for bounced cheques or failed payments.
 * Supports both customer_payment (new) and invoice_payments (legacy).
 *
 * @param {import('pg').PoolClient} client - Open transaction client
 * @param {object} params
 * @param {number} params.paymentId
 * @param {string} [params.sourceTable] - 'customer_payment' | 'invoice_payments' | 'auto'
 * @param {number} [params.bounceFee]
 * @param {string} [params.reason]
 * @param {number} [params.userId]
 */
async function processBouncedCheque(client, { paymentId, sourceTable = 'auto', bounceFee = 0, reason = null, userId = null }) {
  // ── Detect source table if auto ─────────────────────────────────────────
  if (sourceTable === 'auto') {
    const cpCheck = await client.query(
      'SELECT payment_id FROM customer_payment WHERE payment_id = $1', [paymentId]
    );
    sourceTable = (cpCheck?.rows && cpCheck.rows.length > 0) ? 'customer_payment' : 'invoice_payments';
  }

  const parsedFee = parseFloat(bounceFee) || 0;

  if (sourceTable === 'customer_payment') {
    const { rows: [cp] } = await client.query(
      `SELECT cp.payment_id, cp.customer_id, cp.amount, cp.reference_number,
              cp.pdc_status, pm.code AS method_code
       FROM customer_payment cp
       LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
       WHERE cp.payment_id = $1 FOR UPDATE OF cp`,
      [paymentId]
    );
    if (!cp) throw new Error(`Payment #${paymentId} not found in customer_payment`);

    const refNo = cp.reference_number || `CP#${paymentId}`;

    const bounceRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM cheque_clearance_log
       WHERE customer_payment_id = $1 AND action = 'BOUNCED'`,
      [paymentId]
    );
    const bounceCount = bounceRes?.rows?.[0]?.count || 0;
    const attemptNumber = bounceCount + 1;

    // 1. Mark payment as bounced
    await client.query(
      `UPDATE customer_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`,
      [paymentId]
    );

    // 2. Reverse invoice statuses — revert back to Unpaid / Partially Paid
    const allocRes = await client.query(
      `SELECT ipa.invoice_id, ipa.amount_allocated, i.total_amount,
              COALESCE(other_alloc.total_other, 0) AS other_allocated
       FROM invoice_payment_allocation ipa
       JOIN invoice i ON i.invoice_id = ipa.invoice_id
       LEFT JOIN (
         SELECT ia2.invoice_id, SUM(ia2.amount_allocated) AS total_other
         FROM invoice_payment_allocation ia2
         WHERE ia2.payment_id != $1
         GROUP BY ia2.invoice_id
       ) other_alloc ON other_alloc.invoice_id = ipa.invoice_id
       WHERE ipa.payment_id = $1`,
      [paymentId]
    );
    const allocations = allocRes?.rows || [];
    for (const alloc of allocations) {
      const otherPaid = parseFloat(alloc.other_allocated);
      const invoiceTotal = parseFloat(alloc.total_amount);
      const newStatus = otherPaid >= invoiceTotal ? 'Paid' : otherPaid > 0 ? 'Partially Paid' : 'Unpaid';
      await client.query(
        'UPDATE invoice SET status = $1, amount_paid = $2 WHERE invoice_id = $3',
        [newStatus, otherPaid, alloc.invoice_id]
      );
    }

    // 3. AR ledger reversal (+amount to reinstate the receivable)
    await arLedgerService.appendEntry(client, {
      customerId: cp.customer_id,
      paymentId: cp.payment_id,
      entryType: 'PDC_BOUNCED_REVERSAL',
      amount: parseFloat(cp.amount),
      referenceNo: refNo,
      notes: reason || `Bounced cheque reversal for ${refNo} (Attempt #${attemptNumber})`,
      createdBy: userId,
    });

    // 4. Optional bounce fee penalty
    if (parsedFee > 0) {
      await arLedgerService.appendEntry(client, {
        customerId: cp.customer_id,
        paymentId: cp.payment_id,
        entryType: 'BOUNCE_FEE_PENALTY',
        amount: parsedFee,
        referenceNo: refNo,
        notes: `NSF / Bounced cheque fee for ${refNo}`,
        createdBy: userId,
      });
    }

    // 5. Credit hold
    const holdReason = `Bounced Cheque ${refNo} (Attempt #${attemptNumber})${reason ? ': ' + reason : ''}`;
    await client.query(
      `UPDATE customer SET credit_hold = true, credit_hold_reason = $1 WHERE customer_id = $2`,
      [holdReason, cp.customer_id]
    );

    // 6. Audit log
    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      customerPaymentId: cp.payment_id,
      customerId: cp.customer_id,
      action: 'BOUNCED',
      attemptNumber,
      bounceReason: reason || 'NSF / Insufficient Funds',
      bounceFee: parsedFee,
      notes: holdReason,
      createdBy: userId
    });

    return {
      paymentId: cp.payment_id,
      sourceTable: 'customer_payment',
      customerId: cp.customer_id,
      amountReversed: parseFloat(cp.amount),
      bounceFee: parsedFee,
      bounceAttempt: attemptNumber,
      creditHold: true,
      creditHoldReason: holdReason,
    };

  } else {
    // ── Legacy: invoice_payments ──────────────────────────────────────────
    const { rows: [payment] } = await client.query(
      `SELECT ip.payment_id, ip.invoice_id, ip.amount_paid AS amount, i.customer_id,
              ip.reference AS reference_number
       FROM invoice_payments ip
       JOIN invoice i ON i.invoice_id = ip.invoice_id
       WHERE ip.payment_id = $1 FOR UPDATE OF ip`,
      [paymentId]
    );
    if (!payment) throw new Error(`Payment #${paymentId} not found`);

    const refNo = payment.reference_number || `#${paymentId}`;

    const bounceRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM cheque_clearance_log WHERE payment_id = $1 AND action = 'BOUNCED'`,
      [paymentId]
    );
    const bounceCount = bounceRes?.rows?.[0]?.count || 0;
    const attemptNumber = bounceCount + 1;

    await client.query(
      `UPDATE invoice_payments SET payment_status = 'failed', pdc_status = 'BOUNCED' WHERE payment_id = $1`,
      [paymentId]
    );

    await arLedgerService.appendEntry(client, {
      customerId: payment.customer_id,
      invoiceId: payment.invoice_id,
      paymentId: payment.payment_id,
      entryType: 'PDC_BOUNCED_REVERSAL',
      amount: parseFloat(payment.amount),
      referenceNo: refNo,
      notes: reason || `Bounced cheque reversal for ${refNo} (Attempt #${attemptNumber})`,
      createdBy: userId,
    });

    if (parsedFee > 0) {
      await arLedgerService.appendEntry(client, {
        customerId: payment.customer_id,
        invoiceId: payment.invoice_id,
        paymentId: payment.payment_id,
        entryType: 'BOUNCE_FEE_PENALTY',
        amount: parsedFee,
        referenceNo: refNo,
        notes: `NSF / Bounced cheque fee penalty for ${refNo}`,
        createdBy: userId,
      });
    }

    const holdReason = `Bounced Cheque ${refNo} (Attempt #${attemptNumber})${reason ? ': ' + reason : ''}`;
    await client.query(
      `UPDATE customer SET credit_hold = true, credit_hold_reason = $1 WHERE customer_id = $2`,
      [holdReason, payment.customer_id]
    );

    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      paymentId: payment.payment_id,
      customerId: payment.customer_id,
      action: 'BOUNCED',
      attemptNumber,
      bounceReason: reason || 'NSF / Insufficient Funds',
      bounceFee: parsedFee,
      notes: holdReason,
      createdBy: userId
    });

    return {
      paymentId: payment.payment_id,
      invoiceId: payment.invoice_id,
      customerId: payment.customer_id,
      amountReversed: parseFloat(payment.amount),
      bounceFee: parsedFee,
      bounceAttempt: attemptNumber,
      creditHold: true,
      creditHoldReason: holdReason,
    };
  }
}

/**
 * Re-deposit a previously bounced cheque for clearance processing.
 * Supports both customer_payment (new) and invoice_payments (legacy).
 *
 * @param {import('pg').PoolClient} client
 * @param {object} params
 * @param {number} params.paymentId
 * @param {string} [params.sourceTable]
 * @param {boolean} [params.liftCreditHold=false]
 * @param {string} [params.notes]
 * @param {number} [params.userId]
 */
async function processRedepositCheque(client, { paymentId, sourceTable = 'auto', liftCreditHold = false, notes = null, userId = null }) {
  if (sourceTable === 'auto') {
    const { rows: cpCheck } = await client.query(
      'SELECT payment_id FROM customer_payment WHERE payment_id = $1', [paymentId]
    );
    sourceTable = cpCheck.length > 0 ? 'customer_payment' : 'invoice_payments';
  }

  if (sourceTable === 'customer_payment') {
    const { rows: [cp] } = await client.query(
      `SELECT payment_id, customer_id, pdc_status FROM customer_payment WHERE payment_id = $1 FOR UPDATE`,
      [paymentId]
    );
    if (!cp) throw new Error(`Payment #${paymentId} not found`);
    if (cp.pdc_status !== 'BOUNCED') {
      throw new Error(`Only bounced payments can be re-deposited. Current status: ${cp.pdc_status}`);
    }

    const prevRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM cheque_clearance_log
       WHERE customer_payment_id = $1 AND action IN ('BOUNCED', 'REDEPOSITED')`,
      [paymentId]
    );
    const prevAttempts = prevRes?.rows?.[0]?.count || 0;
    const attemptNumber = prevAttempts + 1;

    await client.query(
      `UPDATE customer_payment SET pdc_status = 'DEPOSITED' WHERE payment_id = $1`,
      [paymentId]
    );

    if (liftCreditHold) {
      await client.query(
        `UPDATE customer SET credit_hold = false, credit_hold_reason = NULL WHERE customer_id = $1`,
        [cp.customer_id]
      );
    }

    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      customerPaymentId: cp.payment_id,
      customerId: cp.customer_id,
      action: 'REDEPOSITED',
      attemptNumber,
      notes: notes || `Re-deposited for bank clearance (Attempt #${attemptNumber})`,
      createdBy: userId
    });

    return {
      paymentId: cp.payment_id,
      sourceTable: 'customer_payment',
      customerId: cp.customer_id,
      pdc_status: 'DEPOSITED',
      attemptNumber,
      liftedCreditHold: liftCreditHold
    };

  } else {
    // Legacy invoice_payments path
    const { rows: [payment] } = await client.query(
      `SELECT ip.payment_id, ip.invoice_id, ip.amount_paid AS amount, i.customer_id, ip.pdc_status
       FROM invoice_payments ip
       JOIN invoice i ON i.invoice_id = ip.invoice_id
       WHERE ip.payment_id = $1 FOR UPDATE OF ip`,
      [paymentId]
    );
    if (!payment) throw new Error(`Payment #${paymentId} not found`);
    if (payment.pdc_status !== 'BOUNCED') {
      throw new Error(`Only bounced payments can be re-deposited. Current status: ${payment.pdc_status}`);
    }

    const prevRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM cheque_clearance_log
       WHERE payment_id = $1 AND action IN ('BOUNCED', 'REDEPOSITED')`,
      [paymentId]
    );
    const prevAttempts = prevRes?.rows?.[0]?.count || 0;
    const attemptNumber = prevAttempts + 1;

    await client.query(
      `UPDATE invoice_payments SET payment_status = 'pending', pdc_status = 'DEPOSITED' WHERE payment_id = $1`,
      [paymentId]
    );

    if (liftCreditHold) {
      await client.query(
        `UPDATE customer SET credit_hold = false, credit_hold_reason = NULL WHERE customer_id = $1`,
        [payment.customer_id]
      );
    }

    await logChequeClearanceEvent(client, {
      chequeType: 'INBOUND_CUSTOMER',
      paymentId: payment.payment_id,
      customerId: payment.customer_id,
      action: 'REDEPOSITED',
      attemptNumber,
      notes: notes || `Re-deposited for bank clearance (Attempt #${attemptNumber})`,
      createdBy: userId
    });

    return {
      paymentId: payment.payment_id,
      invoiceId: payment.invoice_id,
      customerId: payment.customer_id,
      pdc_status: 'DEPOSITED',
      payment_status: 'pending',
      attemptNumber,
      liftedCreditHold: liftCreditHold
    };
  }
}

/**
 * Summary KPI stats for PDC & Treasury Desk header cards.
 */
async function getPdcSummaryStats(db) {
  const query = `
    SELECT
      COUNT(CASE WHEN cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE') THEN 1 END)::int AS held_in_safe_count,
      COALESCE(SUM(CASE WHEN cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE') THEN cp.amount ELSE 0 END), 0) AS held_in_safe_total,
      COUNT(CASE WHEN cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED') AND COALESCE(cp.cheque_date, cp.payment_date::date) <= CURRENT_DATE THEN 1 END)::int AS due_today_count,
      COALESCE(SUM(CASE WHEN cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED') AND COALESCE(cp.cheque_date, cp.payment_date::date) <= CURRENT_DATE THEN cp.amount ELSE 0 END), 0) AS due_today_total,
      COALESCE(SUM(CASE WHEN cp.pdc_status = 'CLEARED' AND DATE_TRUNC('month', cp.payment_date) = DATE_TRUNC('month', CURRENT_DATE) THEN cp.amount ELSE 0 END), 0) AS cleared_month_total,
      COUNT(CASE WHEN cp.pdc_status = 'BOUNCED' THEN 1 END)::int AS bounced_count,
      COALESCE(SUM(CASE WHEN cp.pdc_status = 'BOUNCED' THEN cp.amount ELSE 0 END), 0) AS bounced_total
    FROM customer_payment cp
    LEFT JOIN payment_methods pm ON pm.method_id = cp.method_id
    WHERE (pm.type = 'cheque' OR pm.code IN ('cheque', 'pdc') OR cp.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'BOUNCED'))
  `;
  const { rows } = await db.query(query);
  return rows[0] || {
    held_in_safe_count: 0, held_in_safe_total: 0,
    due_today_count: 0, due_today_total: 0,
    cleared_month_total: 0, bounced_count: 0, bounced_total: 0
  };
}

module.exports = {
  getCollectionsClearanceList,
  getChequeClearanceHistory,
  verifyPayment,
  processBouncedCheque,
  processRedepositCheque,
  getPdcSummaryStats,
};

