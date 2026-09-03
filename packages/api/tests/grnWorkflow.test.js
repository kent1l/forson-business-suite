const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

// A single shared client whose query calls we can inspect. The point of most tests in
// this file is what was NOT written, so the recorded call list is the assertion target.
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => Promise.resolve(mockClient)),
}));

jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => { req.user = { employee_id: 7, username: 'reviewer' }; next(); },
  hasPermission: () => (req, res, next) => next(),
}));

jest.mock('../helpers/documentNumberGenerator', () => ({
  getNextDocumentNumber: jest.fn((client, prefix) => Promise.resolve(`${prefix}-202609-0001`)),
}));

jest.mock('../services/apLedgerService', () => ({ appendEntry: jest.fn().mockResolvedValue(1) }));
jest.mock('../services/periodLockService', () => ({ assertPeriodOpen: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/stockReconciliationService', () => ({
  reconcileBackfillLine: jest.fn().mockResolvedValue(null),
  recordWacAfter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/transactionDateService', () => ({ recomputeWacForParts: jest.fn().mockResolvedValue([]) }));

const workflow = require('../services/grnWorkflowService');
const goodsReceiptRouter = require('../routes/goodsReceiptRoutes');

const app = express();
app.use(express.json());
app.use('/api', goodsReceiptRouter);

/** Every SQL string the handler issued, lower-cased, for "did it touch X" assertions. */
const issuedSql = () => mockClient.query.mock.calls.map((c) => String(c[0]).toLowerCase()).join('\n');

describe('grnWorkflowService — the state machine', () => {
  test('the legal moves are exactly the documented ones', () => {
    expect(workflow.TRANSITIONS.Draft).toEqual(['Submitted', 'Cancelled']);
    expect(workflow.TRANSITIONS.Submitted).toEqual(['Posted', 'Draft', 'Cancelled']);
    expect(workflow.TRANSITIONS.Posted).toEqual([]);
    expect(workflow.TRANSITIONS.Cancelled).toEqual([]);
  });

  test.each([
    ['Draft', 'Submitted'],
    ['Draft', 'Cancelled'],
    ['Submitted', 'Posted'],
    ['Submitted', 'Draft'],
    ['Submitted', 'Cancelled'],
  ])('%s → %s is allowed', (from, to) => {
    expect(() => workflow.assertTransition(from, to)).not.toThrow();
  });

  test.each([
    ['Draft', 'Posted'],
    ['Posted', 'Draft'],
    ['Posted', 'Cancelled'],
    ['Cancelled', 'Draft'],
    ['Cancelled', 'Posted'],
  ])('%s → %s is refused with a 409', (from, to) => {
    expect(() => workflow.assertTransition(from, to)).toThrow(
      expect.objectContaining({ statusCode: 409 }),
    );
  });

  test('a receipt cannot be moved to the status it already has', () => {
    expect(() => workflow.assertTransition('Draft', 'Draft')).toThrow(/already draft/i);
  });

  test('posting is refused with advice to void instead', () => {
    expect(() => workflow.assertTransition('Posted', 'Submitted')).toThrow(/void it instead/i);
  });

  test('an unknown target status is a 400, not a 409', () => {
    expect(() => workflow.assertTransition('Draft', 'Approved')).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  test('only Draft and Submitted are editable', () => {
    expect(workflow.isEditable('Draft')).toBe(true);
    expect(workflow.isEditable('Submitted')).toBe(true);
    expect(workflow.isEditable('Posted')).toBe(false);
    expect(workflow.isEditable('Cancelled')).toBe(false);
  });
});

describe('drafts have no financial effect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('creating a draft writes no stock, no bill and no ledger entry', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT INTO goods_receipt ')) {
        return Promise.resolve({ rows: [{ grn_id: 42, grn_number: 'GRD-202609-0001' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).post('/api/goods-receipts/drafts').send({
      supplier_id: 3,
      freight_amount: 500,
      freight_supplier_id: 9,
      lines: [{ part_id: 1, quantity: 10, cost_price: 100 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.grn_id).toBe(42);

    const sql = issuedSql();
    expect(sql).not.toContain('inventory_transaction');
    expect(sql).not.toContain('supplier_bill');
    expect(sql).not.toContain('ap_ledger');
    expect(sql).not.toContain('purchase_order');
    expect(require('../services/apLedgerService').appendEntry).not.toHaveBeenCalled();
    expect(require('../services/transactionDateService').recomputeWacForParts).not.toHaveBeenCalled();
  });

  test('a draft is stored as Draft and given a provisional number, not a GRN number', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('INSERT INTO goods_receipt ')) {
        return Promise.resolve({ rows: [{ grn_id: 1, grn_number: 'GRD-202609-0001' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).post('/api/goods-receipts/drafts').send({
      supplier_id: 3,
      lines: [{ part_id: 1, quantity: 1, cost_price: 10 }],
    });

    // The GRN sequence must not develop gaps from drafts that are never posted.
    expect(res.body.grn_number).toMatch(/^GRD-/);
    const insert = mockClient.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO goods_receipt '));
    expect(String(insert[0])).toContain("'Draft'");
  });

  test('a draft with contradictory discounts is refused before anything is written', async () => {
    const res = await request(app).post('/api/goods-receipts/drafts').send({
      supplier_id: 3,
      lines: [{ part_id: 1, quantity: 1, cost_price: 100, line_discount_percent: 5, line_discount_amount: 5 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/one or the other/i);
    expect(issuedSql()).not.toContain('insert into goods_receipt');
  });

  test('freight without a carrier to bill is refused', async () => {
    const res = await request(app).post('/api/goods-receipts').send({
      supplier_id: 3,
      received_by: 1,
      freight_amount: 250,
      lines: [{ part_id: 1, quantity: 1, cost_price: 100 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/carrier/i);
  });

  test('heavy-item overrides larger than the shipment freight are refused', async () => {
    const res = await request(app).post('/api/goods-receipts/drafts').send({
      supplier_id: 3,
      freight_amount: 100,
      freight_supplier_id: 9,
      lines: [{ part_id: 1, quantity: 1, cost_price: 100, override_freight_amount: 900 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/more than the/i);
  });
});

describe('status transitions over HTTP', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('submitting a draft records who sent it and when', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Draft' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).patch('/api/goods-receipts/5/submit').send({});
    expect(res.status).toBe(200);
    expect(res.body.workflow_status).toBe('Submitted');

    const update = mockClient.query.mock.calls.find((c) => String(c[0]).includes('UPDATE goods_receipt SET workflow_status'));
    expect(String(update[0])).toContain('submitted_by');
    expect(String(update[0])).toContain('submitted_at');
    expect(update[1]).toContain(7); // the acting employee
  });

  test('submitting an already-posted receipt is a 409, and it is rolled back', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Posted' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).patch('/api/goods-receipts/5/submit').send({});
    expect(res.status).toBe(409);
    expect(issuedSql()).toContain('rollback');
  });

  test('a missing receipt is a 404', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).patch('/api/goods-receipts/999/cancel').send({});
    expect(res.status).toBe(404);
  });

  test('cancelling a draft reverses nothing, because nothing was committed', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Draft' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).patch('/api/goods-receipts/5/cancel').send({});
    expect(res.status).toBe(200);
    const sql = issuedSql();
    expect(sql).not.toContain('inventory_transaction');
    expect(sql).not.toContain('ap_ledger');
  });

  test('editing a submitted receipt sends it back to draft for re-review', async () => {
    // Otherwise anyone with goods_receipt:create could rewrite a receipt while an
    // approver had it open, and the post would commit the rewritten figures under the
    // approver's authority.
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Submitted' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).put('/api/goods-receipts/5/draft').send({
      supplier_id: 1,
      lines: [{ part_id: 1, quantity: 1, cost_price: 10 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.returned_to_draft).toBe(true);
    expect(res.body.workflow_status).toBe('Draft');

    const update = mockClient.query.mock.calls.find((c) => String(c[0]).includes('UPDATE goods_receipt\n       SET supplier_id'));
    expect(update[1]).toContain('Draft');
    // The previous approval trail is cleared, so the queue cannot show it as reviewed.
    expect(String(update[0])).toContain('submitted_by = NULL');
    expect(String(update[0])).toContain('submitted_at = NULL');
  });

  test('editing a draft leaves it in draft', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Draft' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).put('/api/goods-receipts/5/draft').send({
      supplier_id: 1,
      lines: [{ part_id: 1, quantity: 1, cost_price: 10 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.returned_to_draft).toBe(false);
  });

  test('editing a posted receipt through the draft endpoint is refused', async () => {
    mockClient.query.mockImplementation((sql) => {
      if (String(sql).includes('SELECT grn_id, workflow_status')) {
        return Promise.resolve({ rows: [{ grn_id: 5, workflow_status: 'Posted' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app).put('/api/goods-receipts/5/draft').send({
      supplier_id: 1,
      lines: [{ part_id: 1, quantity: 1, cost_price: 10 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/posted/i);
  });
});

describe('POST /goods-receipts/:id/post', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  const stagedReceipt = (overrides = {}) => ({
    grn_id: 11, grn_number: 'GRD-202609-0001', supplier_id: 3, received_by: 2,
    po_id: null, bill_id: null, receipt_date: '2026-09-01T00:00:00Z', is_backfill: false,
    supplier_invoice_no: 'SI-100', workflow_status: 'Submitted', freight_amount: '300',
    freight_allocation_method: 'METHOD_A', freight_supplier_id: 9,
    overall_discount_percent: null, overall_discount_amount: null, ...overrides,
  });

  function wireStagedReceipt(receipt, lines) {
    mockClient.query.mockImplementation((sql) => {
      const text = String(sql);
      if (text.includes('FROM goods_receipt WHERE grn_id')) return Promise.resolve({ rows: [receipt] });
      if (text.includes('FROM goods_receipt_line WHERE grn_id')) return Promise.resolve({ rows: lines });
      if (text.includes('INSERT INTO supplier_bill')) {
        return Promise.resolve({ rows: [{ bill_id: 77, bill_number: 'BILL-202609-0001' }] });
      }
      if (text.includes('payment_terms_days')) return Promise.resolve({ rows: [{ payment_terms_days: 30 }] });
      if (text.includes('freight_bill_id FROM goods_receipt')) return Promise.resolve({ rows: [{ freight_bill_id: null }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }

  test('posting stocks in at landed cost, not the raw supplier price', async () => {
    wireStagedReceipt(stagedReceipt(), [
      { grn_line_id: 1, part_id: 100, quantity: '10', cost_price: '100', sale_price: '200',
        line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
        effective_markup_percent: '70', return_quantity: '0' },
    ]);

    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(200);

    const stockIn = mockClient.query.mock.calls.find((c) => String(c[0]).includes("'StockIn'"));
    expect(stockIn).toBeDefined();
    // 1000 of goods plus 300 of freight over 10 units.
    expect(Number(stockIn[1][2])).toBe(130);
  });

  test('a provisional draft number is exchanged for a real GRN number at posting', async () => {
    wireStagedReceipt(stagedReceipt(), [
      // Landed cost here is 400 (100 of goods + all 300 of the freight on one unit),
      // so the price has to clear the 30% floor against 400, not against 100.
      { grn_line_id: 1, part_id: 100, quantity: '1', cost_price: '100', sale_price: '680',
        line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
        effective_markup_percent: '70', return_quantity: '0' },
    ]);

    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(200);
    expect(res.body.grn_number).toBe('GRN-202609-0001');
  });

  test('freight is billed to the carrier, separately from the goods', async () => {
    wireStagedReceipt(stagedReceipt(), [
      { grn_line_id: 1, part_id: 100, quantity: '10', cost_price: '100', sale_price: '250',
        line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
        effective_markup_percent: '70', return_quantity: '0' },
    ]);

    await request(app).post('/api/goods-receipts/11/post').send({});
    const appendEntry = require('../services/apLedgerService').appendEntry;

    const suppliers = appendEntry.mock.calls.map((c) => c[1].supplierId);
    const amounts = appendEntry.mock.calls.map((c) => c[1].amount);
    expect(suppliers).toEqual([3, 9]);   // parts supplier, then carrier
    expect(amounts).toEqual([1000, 300]); // goods net of discount; freight on its own
  });

  test('a receipt already posted cannot be posted twice', async () => {
    wireStagedReceipt(stagedReceipt({ workflow_status: 'Posted' }), []);
    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(409);
    expect(require('../services/apLedgerService').appendEntry).not.toHaveBeenCalled();
  });

  test('posting refuses prices below the 30% markup floor', async () => {
    wireStagedReceipt(stagedReceipt({ freight_amount: '0', freight_supplier_id: null }), [
      { grn_line_id: 1, part_id: 100, quantity: '1', cost_price: '100', sale_price: '105',
        line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
        effective_markup_percent: '5', return_quantity: '0' },
    ]);

    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/30% minimum/);
  });

  test('a receipt with no lines is refused rather than posting an empty document', async () => {
    wireStagedReceipt(stagedReceipt(), []);
    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no line items/i);
  });

  test('a receipt entirely returned at the dock has nothing left to post', async () => {
    wireStagedReceipt(stagedReceipt({ freight_amount: '0', freight_supplier_id: null }), [
      { grn_line_id: 1, part_id: 100, quantity: '5', cost_price: '100', sale_price: '200',
        line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
        effective_markup_percent: '70', return_quantity: '5' },
    ]);
    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no value left/i);
  });

  test('a locked accounting period blocks the post', async () => {
    const lockErr = Object.assign(new Error('That period is closed.'), { statusCode: 423 });
    require('../services/periodLockService').assertPeriodOpen.mockRejectedValueOnce(lockErr);
    wireStagedReceipt(stagedReceipt(), []);

    const res = await request(app).post('/api/goods-receipts/11/post').send({});
    expect(res.status).toBe(423);
  });
});
