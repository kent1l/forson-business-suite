const request = require('supertest');
const express = require('express');

// Mock db module
jest.mock('../db', () => {
  const queryFn = jest.fn();
  const client = {
    query: queryFn,
    release: jest.fn()
  };
  return {
    query: queryFn,
    getClient: jest.fn().mockResolvedValue(client)
  };
});

jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => {
    req.user = { employee_id: 7 };
    next();
  },
  hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');
const invoiceRoutes = require('../routes/invoiceRoutes');

const app = express();
app.use(express.json());
app.use('/api', invoiceRoutes);

describe('PUT /invoices/payments/:payment_id/settle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regression test: this endpoint used to update invoice_payments to 'settled'
  // without ever writing an ar_ledger entry, relying on an incorrect comment
  // claiming the DB trigger handled it (the trigger only updates
  // invoice.amount_paid/status, never ar_ledger).
  test('writes a PAYMENT_SETTLED ar_ledger entry when settling a pending payment', async () => {
    const client = await db.getClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({   // UPDATE invoice_payments ... RETURNING
        rows: [{ invoice_id: 55, amount_paid: '250.00', method_id: 3, reference: 'REF-1' }]
      })
      .mockResolvedValueOnce({   // SELECT customer_id, method code/name
        rows: [{ customer_id: 22, method_code: 'bank_transfer', method_name: 'Bank Transfer' }]
      })
      .mockResolvedValueOnce({ rows: [{ ledger_id: 999 }] }) // append_ar_ledger_entry
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app).put('/api/invoices/payments/301/settle');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Payment settled successfully.');

    const ledgerCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('append_ar_ledger_entry')
    );
    expect(ledgerCall).toBeDefined();
    expect(ledgerCall[1]).toEqual(
      expect.arrayContaining([22, 55, 301, null, 'PAYMENT_SETTLED', -250])
    );
  });

  test('returns 404 without writing to ar_ledger when payment is not pending', async () => {
    const client = await db.getClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // UPDATE ... RETURNING (no match)
      .mockResolvedValueOnce({}); // ROLLBACK

    const res = await request(app).put('/api/invoices/payments/999/settle');

    expect(res.status).toBe(404);
    const ledgerCall = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('append_ar_ledger_entry')
    );
    expect(ledgerCall).toBeUndefined();
  });
});
