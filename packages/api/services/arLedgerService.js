'use strict';

/**
 * Append a single entry to ar_ledger within an existing pg PoolClient transaction.
 * The caller MUST have already issued BEGIN on the client.
 * Uses the append_ar_ledger_entry() Postgres function which:
 *   - Locks the customer's last ledger row (FOR UPDATE) to prevent concurrent balance races
 *   - Computes balance_after as prev_balance + amount automatically
 *
 * Sign convention:
 *   amount > 0  →  balance increases (INVOICE_POSTED, DEBIT_ADJUSTMENT)
 *   amount < 0  →  balance decreases (PAYMENT_SETTLED, CREDIT_MEMO_APPLIED, CREDIT_ADJUSTMENT)
 *
 * @param {import('pg').PoolClient} client  — open transaction client
 * @param {object} opts
 * @param {number}  opts.customerId
 * @param {number}  [opts.invoiceId]
 * @param {number}  [opts.paymentId]
 * @param {number}  [opts.cnId]
 * @param {string}  opts.entryType          — ar_ledger_entry_type enum value
 * @param {number}  opts.amount             — signed amount
 * @param {string}  [opts.paymentChannel]   — payment_methods.code ('cash','bank_transfer', …)
 * @param {string}  [opts.referenceNo]
 * @param {string}  [opts.notes]
 * @param {number}  [opts.createdBy]        — employee_id
 * @param {string}  [opts.paymentSource]    — 'invoice_payments' | 'customer_payment'
 * @param {Date|string} [opts.entryDate]    — business date this entry represents;
 *                                             defaults to now (see append_ar_ledger_entry
 *                                             in 20260816_01_add_entry_date_to_ledgers.sql).
 *                                             Corrected later only via transactionDateService.
 * @returns {Promise<number>} ledger_id of the newly inserted row
 */
async function appendEntry(client, {
  customerId,
  invoiceId      = null,
  paymentId      = null,
  cnId           = null,
  entryType,
  amount,
  paymentChannel = null,
  referenceNo    = null,
  notes          = null,
  createdBy      = null,
  paymentSource  = null,
  entryDate      = null,
}) {
  const { rows } = await client.query(
    `SELECT append_ar_ledger_entry(
       $1, $2, $3, $4,
       $5::ar_ledger_entry_type,
       $6, $7, $8, $9, $10, $11, COALESCE($12, CURRENT_TIMESTAMP)
     ) AS ledger_id`,
    [customerId, invoiceId, paymentId, cnId,
     entryType, amount, paymentChannel, referenceNo, notes, createdBy, paymentSource, entryDate],
  );
  return rows[0].ledger_id;
}

module.exports = { appendEntry };
