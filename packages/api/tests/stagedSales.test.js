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

// Mock helpers and services
jest.mock('../helpers/documentNumberGenerator', () => ({
  getNextDocumentNumber: jest.fn().mockResolvedValue('INV-2026-0001')
}));

jest.mock('../helpers/receiptNumberFormatter', () => ({
  formatPhysicalReceiptNumber: jest.fn(val => val)
}));

jest.mock('../helpers/paymentTermsHelper', () => ({
  validatePaymentTerms: jest.fn().mockReturnValue({
    isValid: true,
    canonicalDays: 0,
    dueDate: new Date(),
    normalizedTerms: 'COD'
  })
}));

jest.mock('../services/taxCalculationService', () => ({
  calculateInvoiceTax: jest.fn().mockResolvedValue({
    subtotal_ex_tax: 100,
    tax_total: 12,
    total_amount: 112,
    tax_calculation_version: 1,
    tax_breakdown: [],
    lines: [
      {
        part_id: 1,
        quantity: 1,
        sale_price: 112,
        discount_amount: 0,
        tax_rate_id: 1,
        tax_rate_snapshot: 0.12,
        tax_base: 100,
        tax_amount: 12,
        is_tax_inclusive: true
      }
    ]
  }),
  storeTaxBreakdown: jest.fn().mockResolvedValue({}),
  validateTaxCalculation: jest.fn().mockReturnValue(true)
}));

jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => {
    req.user = { employee_id: 10 };
    next();
  },
  hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');

describe('staged sales routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    const stagedSaleRoutes = require('../routes/stagedSaleRoutes');
    app.use('/api', stagedSaleRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/sales/staging returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/sales/staging')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message', 'Missing required staging fields.');
  });

  it('POST /api/sales/staging successfully stages transaction', async () => {
    const client = await db.getClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ staged_sale_id: 42 }] }) // insert staged_sale
      .mockResolvedValueOnce({}) // insert staged_sale_line
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .post('/api/sales/staging')
      .send({
        customer_id: 1,
        employee_id: 10,
        lines: [{ part_id: 1, quantity: 1, sale_price: 112, discount_amount: 0 }],
        payment_method_id: 2
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message', 'Transaction successfully staged.');
    expect(res.body).toHaveProperty('staged_sale_id', 42);
    expect(res.body).toHaveProperty('staged_number', 'STG-42');
  });

  it('POST /api/sales/staging/:id/approve-post approves and finalizes sale', async () => {
    const client = await db.getClient();
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({   // Fetch staged sale
        rows: [{
          staged_sale_id: 42,
          customer_id: 1,
          employee_id: 10,
          total_amount: '112.00',
          tax_rate_id: 1,
          physical_receipt_no: 'SI-999',
          payment_method_id: 2,
          tendered_amount: '200.00',
          status: 'PENDING'
        }]
      })
      .mockResolvedValueOnce({   // Fetch staged sale lines
        rows: [{
          staged_line_id: 100,
          staged_sale_id: 42,
          part_id: 1,
          quantity: '1.0000',
          sale_price: '112.00',
          discount_amount: '0.00'
        }]
      })
      .mockResolvedValueOnce({ rows: [] }) // check existing receipt no
      .mockResolvedValueOnce({   // get part details
        rows: [{
          part_id: 1,
          tax_rate_id: 1,
          is_tax_inclusive_price: true
        }]
      })
      .mockResolvedValueOnce({ rows: [{ invoice_id: 50 }] }) // insert invoice
      .mockResolvedValueOnce({ rows: [{ wac_cost: '50.00' }] }) // get WAC cost
      .mockResolvedValueOnce({}) // insert invoice_line
      .mockResolvedValueOnce({}) // insert inventory_transaction
      .mockResolvedValueOnce({ rows: [{ method_id: 2, name: 'Cash', type: 'cash', config: {} }] }) // check payment method
      .mockResolvedValueOnce({}) // insert payment
      .mockResolvedValueOnce({}) // update staged_sale status
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .post('/api/sales/staging/42/approve-post')
      .send({ physical_receipt_no: 'SI-999', tendered_amount: 112 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Staged sale approved and recorded successfully.');
    expect(res.body).toHaveProperty('invoice_id', 50);
  });

  it('POST /api/sales/staging/:id/reject rejects staged sale', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ staged_sale_id: 42, status: 'REJECTED' }]
    });

    const res = await request(app)
      .post('/api/sales/staging/42/reject')
      .send({ reason: 'Pricing mismatch', notes: 'Discount error' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Transaction rejected successfully.');
  });
});
