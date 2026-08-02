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
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} [pdcStatusFilter]
 * @param {string} [maturityFilter] - 'ALL', 'DUE_TODAY', 'FUTURE_PDC', 'STALE_CHEQUE'
 */
async function getCollectionsClearanceList(db, pdcStatusFilter = null, maturityFilter = null) {
  let whereClause = ``;
  const params = [];

  if (pdcStatusFilter && pdcStatusFilter !== 'ALL') {
    params.push(pdcStatusFilter);
    whereClause = `WHERE (ip.pdc_status = $1 OR (ip.payment_status = 'pending' AND $1 = 'RECEIVED'))`;
  } else {
    whereClause = `WHERE ip.pdc_status IN ('RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED') OR ip.payment_status = 'pending'`;
  }

  const query = `
    SELECT 
      ip.payment_id,
      ip.invoice_id,
      i.invoice_number,
      i.customer_id,
      c.company_name,
      c.first_name,
      c.last_name,
      ip.amount_paid AS amount,
      ip.payment_status,
      COALESCE(ip.pdc_status, 'CLEARED') AS pdc_status,
      ip.method_id AS payment_method_id,
      pm.name AS payment_method_name,
      pm.code AS payment_method_code,
      ip.reference AS reference_number,
      ip.metadata->>'cheque_date' AS cheque_date,
      ip.created_at AS payment_date,
      ip.created_at
    FROM invoice_payments ip
    JOIN invoice i ON i.invoice_id = ip.invoice_id
    JOIN customer c ON c.customer_id = i.customer_id
    LEFT JOIN payment_methods pm ON pm.method_id = ip.method_id
    ${whereClause}
    ORDER BY ip.created_at DESC;
  `;
  const { rows } = await db.query(query, params);
  const mapped = rows.map(computePdcMaturity);

  if (maturityFilter && maturityFilter !== 'ALL') {
    return mapped.filter(r => r.maturity_status === maturityFilter);
  }

  return mapped;
}

/**
 * Verify and clear a pending payment/PDC.
 * @param {import('pg').PoolClient} client - Open transaction client
 * @param {object} params
 * @param {number} params.paymentId
 * @param {number} [params.userId]
 */
async function verifyPayment(client, { paymentId, userId = null }) {
  const selectRes = await client.query(
    `SELECT ip.payment_id, ip.invoice_id, ip.amount_paid AS amount, ip.payment_status, ip.pdc_status
     FROM invoice_payments ip
     WHERE ip.payment_id = $1 FOR UPDATE`,
    [paymentId]
  );
  if (selectRes.rows.length === 0) {
    throw new Error(`Payment #${paymentId} not found`);
  }

  const updateRes = await client.query(
    `UPDATE invoice_payments
     SET payment_status = 'settled',
         pdc_status = 'CLEARED'
     WHERE payment_id = $1
     RETURNING payment_id, invoice_id, amount_paid AS amount, payment_status, pdc_status`,
    [paymentId]
  );

  return updateRes.rows[0];
}

/**
 * Automated processor for bounced cheques or failed payments.
 * @param {import('pg').PoolClient} client - Open transaction client
 * @param {object} params
 * @param {number} params.paymentId
 * @param {number} [params.bounceFee]
 * @param {string} [params.reason]
 * @param {number} [params.userId]
 */
async function processBouncedCheque(client, { paymentId, bounceFee = 0, reason = null, userId = null }) {
  const selectRes = await client.query(
    `SELECT 
       ip.payment_id,
       ip.invoice_id,
       ip.amount_paid AS amount,
       i.customer_id,
       ip.reference AS reference_number
     FROM invoice_payments ip
     JOIN invoice i ON i.invoice_id = ip.invoice_id
     WHERE ip.payment_id = $1 FOR UPDATE`,
    [paymentId]
  );

  if (selectRes.rows.length === 0) {
    throw new Error(`Payment #${paymentId} not found`);
  }

  const payment = selectRes.rows[0];
  const refNo = payment.reference_number || `#${paymentId}`;
  const parsedFee = parseFloat(bounceFee) || 0;

  // 1. Update payment status to failed and pdc_status to BOUNCED
  await client.query(
    `UPDATE invoice_payments
     SET payment_status = 'failed',
         pdc_status = 'BOUNCED'
     WHERE payment_id = $1`,
    [paymentId]
  );

  // 2. Append PDC_BOUNCED_REVERSAL to ar_ledger (+amount)
  await arLedgerService.appendEntry(client, {
    customerId: payment.customer_id,
    invoiceId: payment.invoice_id,
    paymentId: payment.payment_id,
    entryType: 'PDC_BOUNCED_REVERSAL',
    amount: parseFloat(payment.amount),
    referenceNo: refNo,
    notes: reason || `Bounced cheque reversal for ${refNo}`,
    createdBy: userId,
  });

  // 3. Append optional BOUNCE_FEE_PENALTY to ar_ledger (+fee)
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

  // 4. Update customer credit hold status
  const holdReason = `Bounced Cheque ${refNo}${reason ? ': ' + reason : ''}`;
  await client.query(
    `UPDATE customer
     SET credit_hold = true,
         credit_hold_reason = $1
     WHERE customer_id = $2`,
    [holdReason, payment.customer_id]
  );

  return {
    paymentId: payment.payment_id,
    invoiceId: payment.invoice_id,
    customerId: payment.customer_id,
    amountReversed: parseFloat(payment.amount),
    bounceFee: parsedFee,
    creditHold: true,
    creditHoldReason: holdReason,
  };
}

module.exports = {
  getCollectionsClearanceList,
  verifyPayment,
  processBouncedCheque,
};
