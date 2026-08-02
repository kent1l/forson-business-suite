'use strict';
const db = require('../db');

/**
 * Fetch customer wallet summary and balance.
 * Returns balance 0.00 if customer has no wallet record created yet.
 *
 * @param {number} customerId
 * @param {import('pg').PoolClient} [client] - Optional database client for transaction context
 * @returns {Promise<{wallet_id: number|null, customer_id: number, balance: number, updated_at: string|null}>}
 */
async function getWallet(customerId, client = null) {
  const runner = client || db;
  const query = `
    SELECT 
      w.wallet_id,
      c.customer_id,
      COALESCE(w.balance, 0.00) AS balance,
      w.updated_at
    FROM customer c
    LEFT JOIN customer_wallet w ON w.customer_id = c.customer_id
    WHERE c.customer_id = $1;
  `;
  const { rows } = await runner.query(query, [customerId]);
  if (!rows.length) return null;
  return {
    wallet_id: rows[0].wallet_id || null,
    customer_id: rows[0].customer_id,
    balance: parseFloat(rows[0].balance || 0),
    updated_at: rows[0].updated_at || null,
  };
}

/**
 * Append transaction to customer wallet within an active database client (transaction).
 * Uses Postgres append_wallet_transaction() with FOR UPDATE row locking.
 *
 * @param {import('pg').PoolClient} client — open PG transaction client
 * @param {object} opts
 * @param {number} opts.customerId
 * @param {'OVERPAYMENT_CREDIT'|'ADVANCE_DEPOSIT'|'STORE_CREDIT_REFUND'|'INVOICE_PAYMENT_DRAWDOWN'|'MANUAL_ADJUSTMENT'} opts.type
 * @param {number} opts.amount — positive for credits/deposits, negative for drawdowns
 * @param {string} [opts.referenceType] — e.g. 'INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'MANUAL'
 * @param {number} [opts.referenceId]
 * @param {string} [opts.notes]
 * @param {number} [opts.createdBy]
 * @returns {Promise<number>} transaction_id of inserted wallet audit log
 */
async function appendWalletTransaction(client, {
  customerId,
  type,
  amount,
  referenceType = null,
  referenceId = null,
  notes = null,
  createdBy = null,
}) {
  const { rows } = await client.query(
    `SELECT append_wallet_transaction(
       $1,
       $2::wallet_transaction_type,
       $3,
       $4,
       $5,
       $6,
       $7
     ) AS tx_id`,
    [
      customerId,
      type,
      amount,
      referenceType,
      referenceId,
      notes,
      createdBy,
    ]
  );
  return rows[0].tx_id;
}

module.exports = {
  getWallet,
  appendWalletTransaction,
};
