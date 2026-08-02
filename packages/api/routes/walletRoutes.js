'use strict';
const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const walletService = require('../services/customerWalletService');
const { parsePaginationQuery, paginatedResponse } = require('../helpers/pagination');
const router = express.Router();

// GET /api/customers/:id/wallet - Get customer wallet info & transaction history
router.get('/customers/:id/wallet', protect, hasPermission('ar:view'), async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  if (!customerId) return res.status(400).json({ message: 'Invalid customer ID' });

  try {
    const wallet = await walletService.getWallet(customerId);
    if (!wallet) return res.status(404).json({ message: 'Customer not found' });

    const { page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    const countRes = await db.query(
      'SELECT COUNT(*) FROM customer_wallet_transaction WHERE customer_id = $1',
      [customerId]
    );
    const totalItems = parseInt(countRes.rows[0].count, 10);

    const txRes = await db.query(
      `SELECT 
        transaction_id, transaction_type, amount, balance_after,
        reference_type, reference_id, notes, created_by, created_at
       FROM customer_wallet_transaction
       WHERE customer_id = $1
       ORDER BY created_at DESC, transaction_id DESC
       LIMIT $2 OFFSET $3`,
      [customerId, limit, offset]
    );

    return res.json({
      wallet,
      transactions: paginatedResponse({ data: txRes.rows, page, pageSize, total: totalItems }),
    });
  } catch (err) {
    console.error('Error fetching wallet:', err.message);
    return res.status(500).json({ message: 'Server error fetching wallet data' });
  }
});

// POST /api/customers/:id/wallet/adjust - Admin manual balance adjustment
router.post('/customers/:id/wallet/adjust', protect, hasPermission('ar:manage'), async (req, res) => {
  const customerId = parseInt(req.params.id, 10);
  const { amount, notes } = req.body;
  const { employee_id } = req.user;

  if (!customerId || amount === undefined || isNaN(parseFloat(amount))) {
    return res.status(400).json({ message: 'Valid customer ID and numerical amount are required.' });
  }

  const numAmount = parseFloat(amount);
  if (numAmount === 0) return res.status(400).json({ message: 'Adjustment amount cannot be zero.' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const txId = await walletService.appendWalletTransaction(client, {
      customerId,
      type: 'MANUAL_ADJUSTMENT',
      amount: numAmount,
      referenceType: 'MANUAL',
      referenceId: null,
      notes: notes || 'Manual administrative wallet balance adjustment',
      createdBy: employee_id,
    });

    await client.query('COMMIT');
    const updatedWallet = await walletService.getWallet(customerId);
    return res.json({
      message: 'Wallet balance adjusted successfully',
      transaction_id: txId,
      wallet: updatedWallet,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Wallet Adjustment Error:', err.message);
    return res.status(400).json({ message: err.message || 'Failed to adjust wallet balance' });
  } finally {
    client.release();
  }
});

// GET /api/ar/customer-liabilities - Aggregated customer receivables vs wallet credit view
router.get('/ar/customer-liabilities', protect, hasPermission('ar:view'), async (req, res) => {
  try {
    const { page, pageSize, offset, limit } = parsePaginationQuery(req.query);

    const countRes = await db.query('SELECT COUNT(*) FROM customer');
    const totalItems = parseInt(countRes.rows[0].count, 10);

    const query = `
      SELECT 
        c.customer_id,
        c.company_name,
        c.first_name,
        c.last_name,
        COALESCE(ab.ledger_balance, 0.00) AS ar_balance,
        COALESCE(w.balance, 0.00)        AS wallet_balance,
        (COALESCE(ab.ledger_balance, 0.00) - COALESCE(w.balance, 0.00)) AS net_exposure
      FROM customer c
      LEFT JOIN vw_customer_ar_balance ab ON ab.customer_id = c.customer_id
      LEFT JOIN customer_wallet w ON w.customer_id = c.customer_id
      WHERE (ab.ledger_balance > 0 OR w.balance > 0)
      ORDER BY net_exposure DESC
      LIMIT $1 OFFSET $2;
    `;

    const { rows } = await db.query(query, [limit, offset]);
    return res.json(paginatedResponse({ data: rows, page, pageSize, total: totalItems }));
  } catch (err) {
    console.error('Error fetching customer liabilities:', err.message);
    return res.status(500).json({ message: 'Server error fetching customer liabilities' });
  }
});

module.exports = router;
