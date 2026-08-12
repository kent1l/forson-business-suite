'use strict';

/**
 * Append a single entry to ap_ledger within an existing pg PoolClient transaction.
 * The caller MUST have already issued BEGIN on the client.
 * Uses the append_ap_ledger_entry() Postgres function which:
 *   - Locks the supplier's last ledger row (FOR UPDATE) to prevent concurrent balance races
 *   - Computes balance_after as prev_balance + amount automatically
 *
 * Sign convention:
 *   amount > 0  →  liability increases (BILL_POSTED, PDC_BOUNCED_REVERSAL, BOUNCE_FEE_PENALTY, DEBIT_ADJUSTMENT)
 *   amount < 0  →  liability decreases (PAYMENT_SETTLED, CREDIT_ADJUSTMENT)
 *
 * @param {import('pg').PoolClient} client  — open transaction client
 * @param {object} opts
 * @param {number}  opts.supplierId
 * @param {number}  [opts.billId]
 * @param {number}  [opts.paymentId]
 * @param {string}  opts.entryType          — ap_ledger_entry_type enum value
 * @param {number}  opts.amount             — signed amount
 * @param {string}  [opts.paymentChannel]   — payment_methods.code ('cash','bank_transfer','cheque', …)
 * @param {string}  [opts.referenceNo]
 * @param {string}  [opts.notes]
 * @param {number}  [opts.createdBy]        — employee_id
 * @returns {Promise<number>} ledger_id of the newly inserted row
 */
async function appendEntry(client, {
  supplierId,
  billId         = null,
  paymentId      = null,
  entryType,
  amount,
  paymentChannel = null,
  referenceNo    = null,
  notes          = null,
  createdBy      = null,
}) {
  const { rows } = await client.query(
    `SELECT append_ap_ledger_entry(
       $1, $2, $3,
       $4::ap_ledger_entry_type,
       $5, $6, $7, $8, $9
     ) AS ledger_id`,
    [supplierId, billId, paymentId,
     entryType, amount, paymentChannel, referenceNo, notes, createdBy],
  );
  return rows[0].ledger_id;
}

module.exports = { appendEntry };
