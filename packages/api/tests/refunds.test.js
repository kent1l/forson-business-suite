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
          discount_amount: '0.00',
          cost_at_sale: '60.00',
          tax_rate_id: 1,
          tax_rate_snapshot: '0.120000',
          is_tax_inclusive: true,
          refunded_quantity: '0.0000'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_name: 'VAT 12%' }] }) // tax rates names query
      .mockResolvedValueOnce({ rows: [{ customer_id: 10 }] }) // customer_id lookup
      .mockResolvedValueOnce({ rows: [{ cn_id: 42 }] }) // insert credit note
      .mockResolvedValueOnce({ rows: [{ ledger_id: 1 }] }) // append_ar_ledger_entry
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

  it('POST /api/refunds prorates the original line discount across a partial refund', async () => {
    const client = await db.getClient();

    // Original line: 4 units at 100 with a 40 discount on the whole line, taxed
    // exclusively at 12%. Refunding 2 units gets back 2 units of price less
    // 2 units' share of the discount: (2*100) - (10*2) = 180, not 200.
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({   // validation query
        rows: [{
          invoice_line_id: 101,
          part_id: 5,
          original_quantity: '4.0000',
          sale_price: '100.00',
          discount_amount: '40.00',
          cost_at_sale: '60.00',
          tax_rate_id: 1,
          tax_rate_snapshot: '0.120000',
          is_tax_inclusive: false,
          refunded_quantity: '0.0000'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_name: 'VAT 12%' }] }) // rate names
      .mockResolvedValueOnce({ rows: [{ customer_id: 10 }] }) // customer_id lookup
      .mockResolvedValueOnce({ rows: [{ cn_id: 43 }] }) // insert credit note
      .mockResolvedValueOnce({ rows: [{ ledger_id: 2 }] }) // append_ar_ledger_entry
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
        lines: [{ invoice_line_id: 101, part_id: 5, quantity: 2 }]
      });

    expect(res.status).toBe(201);
    // 180 base + 21.60 tax, rather than the 200 + 24 the gross price would give.
    expect(res.body.total_refunded).toBe(201.6);

    const creditNoteInsertCall = client.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO credit_note ')
    );
    // params: [cn_number, invoice_id, employee_id, total_amount, subtotal_ex_tax, tax_total, ...]
    expect(creditNoteInsertCall[1][3]).toBe(201.6); // total_amount
    expect(creditNoteInsertCall[1][4]).toBe(180);   // subtotal_ex_tax
    expect(creditNoteInsertCall[1][5]).toBe(21.6);  // tax_total

    const lineInsertCall = client.query.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO credit_note_line')
    );
    // params: [cn_id, part_id, quantity, sale_price, tax_rate_id, tax_rate_snapshot, tax_base, tax_amount, ...]
    expect(lineInsertCall[1][6]).toBe(180);  // tax_base
    expect(lineInsertCall[1][7]).toBe(21.6); // tax_amount
  });
});
