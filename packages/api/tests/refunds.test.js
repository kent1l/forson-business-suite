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

// Mock helpers and middleware
jest.mock('../helpers/documentNumberGenerator', () => ({
  getNextDocumentNumber: jest.fn().mockResolvedValue('CN-2026-0001')
}));

jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => {
    req.user = { employee_id: 10 };
    next();
  },
  hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');

describe('refund routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    const refundRoutes = require('../routes/refundRoutes');
    app.use('/api', refundRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/refunds returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/refunds')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message', 'Missing required fields for refund.');
  });

  it('POST /api/refunds successfully processes refund and adjusts inventory cost', async () => {
    const client = await db.getClient();
    
    // Setup queries responses:
    // 1. BEGIN transaction -> resolved
    // 2. validation query for line -> resolved with original line details including cost_at_sale
    // 3. Select tax rates -> resolved with default rate
    // 4. Insert credit_note -> resolved returning cn_id = 42
    // 5. Insert breakdown -> resolved
    // 6. Insert credit_note_line -> resolved
    // 7. Insert inventory_transaction -> resolved
    // 8. COMMIT transaction -> resolved
    
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({   // validation query
        rows: [{
          invoice_line_id: 101,
          part_id: 5,
          original_quantity: '5.0000',
          sale_price: '100.00',
          cost_at_sale: '60.00',
          tax_rate_id: 1,
          tax_rate_snapshot: '0.120000',
          is_tax_inclusive: true,
          refunded_quantity: '0.0000'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_name: 'VAT 12%' }] }) // tax rates names query
      .mockResolvedValueOnce({ rows: [{ cn_id: 42 }] }) // insert credit note
      .mockResolvedValueOnce({}) // insert breakdown
      .mockResolvedValueOnce({}) // insert credit_note_line
      .mockResolvedValueOnce({}) // insert inventory_transaction
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .post('/api/refunds')
      .send({
        invoice_id: 99,
        invoice_number: 'INV-99',
        employee_id: 10,
        refund_payment_method: 'GCash',
        lines: [
          { invoice_line_id: 101, part_id: 5, quantity: 2 }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message', 'Refund processed successfully');
    expect(res.body).toHaveProperty('creditNoteNumber', 'CN-2026-0001');
    expect(res.body).toHaveProperty('total_refunded', 200);

    // Verify correct DB calls
    // Credit note query should contain GCash as payment method
    const creditNoteInsertCall = client.query.mock.calls.find(call => 
      typeof call[0] === 'string' && call[0].includes('INSERT INTO credit_note')
    );
    expect(creditNoteInsertCall).toBeDefined();
    expect(creditNoteInsertCall[1]).toContain('GCash');

    // Inventory transaction query should use cost_at_sale (60.00) instead of sale_price (100.00)
    const inventoryInsertCall = client.query.mock.calls.find(call => 
      typeof call[0] === 'string' && call[0].includes('INSERT INTO inventory_transaction')
    );
    expect(inventoryInsertCall).toBeDefined();
    // params order: [part_id, quantity, cost_at_sale, reference_no, employee_id, notes]
    expect(inventoryInsertCall[1][0]).toBe(5); // part_id
    expect(inventoryInsertCall[1][1]).toBe(2); // quantity
    expect(inventoryInsertCall[1][2]).toBe(60.00); // unit_cost (cost_at_sale)
    expect(inventoryInsertCall[1][3]).toBe('CN-2026-0001'); // reference_no
  });
});
