const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => Promise.resolve(mockClient)),
}));

jest.mock('../middleware/authMiddleware', () => ({
  protect: (req, res, next) => { req.user = { employee_id: 4, username: 'clerk' }; next(); },
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

const apLedgerService = require('../services/apLedgerService');
const { recomputeWacForParts } = require('../services/transactionDateService');
const goodsReceiptRouter = require('../routes/goodsReceiptRoutes');

const app = express();
app.use(express.json());
app.use('/api', goodsReceiptRouter);

const issuedSql = () => mockClient.query.mock.calls.map((c) => String(c[0]).toLowerCase()).join('\n');
const findCall = (needle) => mockClient.query.mock.calls.find((c) => String(c[0]).includes(needle));

const RECEIPT = {
  grn_id: 20, grn_number: 'GRN-202609-0007', supplier_id: 3, bill_id: 55, po_id: null,
  status: 'Active', workflow_status: 'Posted', receipt_date: '2026-09-01T00:00:00Z',
  is_backfill: false, freight_amount: '200', freight_allocation_method: 'METHOD_A',
  overall_discount_percent: null, overall_discount_amount: null,
};

const LINES = [
  { grn_line_id: 501, part_id: 100, quantity: '10', cost_price: '100', sale_price: '250',
    line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
    effective_markup_percent: '70', return_quantity: '0', landed_unit_cost: '110' },
  { grn_line_id: 502, part_id: 200, quantity: '10', cost_price: '100', sale_price: '250',
    line_discount_percent: null, line_discount_amount: null, override_freight_amount: null,
    effective_markup_percent: '70', return_quantity: '0', landed_unit_cost: '110' },
];

function wire({ receipt = RECEIPT, lines = LINES, onHand = 10, bill = null } = {}) {
  mockClient.query.mockImplementation((sql) => {
    const text = String(sql);
    if (text.includes('FROM goods_receipt WHERE grn_id')) return Promise.resolve({ rows: [receipt] });
    if (text.includes('FROM goods_receipt_line WHERE grn_id')) return Promise.resolve({ rows: lines });
    if (text.includes('SUM(quantity), 0) AS on_hand')) return Promise.resolve({ rows: [{ on_hand: String(onHand) }] });
    if (text.includes('FROM supplier_bill WHERE bill_id')) {
      return Promise.resolve({
        rows: [bill || { bill_id: 55, bill_number: 'BILL-1', supplier_id: 3, total_amount: '2000', amount_paid: '0', status: 'Unpaid' }],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('rejection on a draft — nothing financial happens', () => {
  test('the quantity is reduced and no stock or ledger entry is written', async () => {
    wire({ receipt: { ...RECEIPT, workflow_status: 'Draft', bill_id: null } });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 3, rejection_reason: 'Damaged' });

    expect(res.status).toBe(200);
    expect(res.body.return_quantity).toBe(3);
    expect(res.body.credit_amount).toBe(0);
    expect(res.body.message).toMatch(/draft/i);

    const sql = issuedSql();
    expect(sql).not.toContain('insert into inventory_transaction');
    expect(apLedgerService.appendEntry).not.toHaveBeenCalled();
    expect(recomputeWacForParts).not.toHaveBeenCalled();
  });

  test('rejecting one line re-spreads the freight over what is left', async () => {
    wire({ receipt: { ...RECEIPT, workflow_status: 'Draft', bill_id: null } });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 5, rejection_reason: 'Wrong Part' });

    // 5 of 10 gone from line one: the 200 freight now splits 500:1000, not 1000:1000.
    expect(res.body.totals.net_goods_value).toBe(1500);
    const updates = mockClient.query.mock.calls.filter((c) => String(c[0]).includes('UPDATE goods_receipt_line'));
    expect(updates).toHaveLength(2); // every line is rewritten, not just the rejected one
  });
});

describe('return on a posted receipt — stock and payable both move', () => {
  test('stock is reversed at landed cost and WAC is replayed', async () => {
    wire();

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 2, rejection_reason: 'Defective' });

    expect(res.status).toBe(200);

    const stockOut = findCall("'StockOut'");
    expect(stockOut).toBeDefined();
    expect(Number(stockOut[1][1])).toBe(-2);   // negative quantity, never a deletion
    expect(Number(stockOut[1][2])).toBe(110);  // the landed cost it came in at
    expect(String(stockOut[1][5])).toMatch(/RETURN TO SUPPLIER: Defective/);

    // The trigger only maintains WAC on StockIn, so a reversal must replay explicitly.
    expect(recomputeWacForParts).toHaveBeenCalledWith(mockClient, [100]);
  });

  test('the payable is credited with a RETURN_CREDIT, excluding freight', async () => {
    wire();

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 2, rejection_reason: 'Supplier Error' });

    // 2 units at the 100 goods cost. The carrier still charged to deliver them, so the
    // freight share is not refunded by the parts supplier.
    expect(res.body.credit_amount).toBe(200);

    expect(apLedgerService.appendEntry).toHaveBeenCalledWith(mockClient, expect.objectContaining({
      entryType: 'RETURN_CREDIT',
      amount: -200,
      billId: 55,
      supplierId: 3,
    }));

    const billUpdate = findCall('UPDATE supplier_bill SET total_amount');
    expect(Number(billUpdate[1][0])).toBe(1800);
  });

  test('a line discount reduces the credit proportionally', async () => {
    wire({
      lines: [
        { ...LINES[0], line_discount_percent: '20', landed_unit_cost: '90' },
        LINES[1],
      ],
    });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 2, rejection_reason: 'Damaged' });

    // The supplier was only paid 80 a unit for these, so only 160 comes back.
    expect(res.body.credit_amount).toBe(160);
  });

  test('returning stock that has already been sold is refused', async () => {
    wire({ onHand: 1 });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 5, rejection_reason: 'Damaged' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been sold/i);
    expect(issuedSql()).toContain('rollback');
    expect(apLedgerService.appendEntry).not.toHaveBeenCalled();
  });

  test('a return that would take a bill below what has been paid is refused', async () => {
    wire({ bill: { bill_id: 55, bill_number: 'BILL-1', supplier_id: 3, total_amount: '2000', amount_paid: '1900', status: 'Partially Paid' } });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 5, rejection_reason: 'Damaged' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been paid/i);
    expect(apLedgerService.appendEntry).not.toHaveBeenCalled();
  });

  test('returning more than the line holds is refused', async () => {
    wire({ lines: [{ ...LINES[0], return_quantity: '8' }, LINES[1]] });

    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 5, rejection_reason: 'Damaged' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/still on hand to return/i);
  });

  test('a voided receipt has nothing left to return', async () => {
    wire({ receipt: { ...RECEIPT, status: 'Voided' } });
    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 1, rejection_reason: 'Damaged' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/voided/i);
  });

  test('a cancelled draft can no longer be changed', async () => {
    wire({ receipt: { ...RECEIPT, workflow_status: 'Cancelled' } });
    const res = await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 1, rejection_reason: 'Damaged' });
    expect(res.status).toBe(409);
  });
});

describe('return validation', () => {
  test.each([
    [{ return_quantity: 0, rejection_reason: 'Damaged' }, /how many units/i],
    [{ return_quantity: -2, rejection_reason: 'Damaged' }, /how many units/i],
    [{ return_quantity: 1 }, /choose a reason/i],
    [{ return_quantity: 1, rejection_reason: 'Because' }, /choose a reason/i],
    [{ return_quantity: 1, rejection_reason: 'Other' }, /describe the problem/i],
  ])('%o is refused', async (body, expectedMessage) => {
    wire();
    const res = await request(app).post('/api/goods-receipts/20/lines/501/return').send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(expectedMessage);
  });

  test('the five documented reasons are all accepted', async () => {
    for (const reason of ['Damaged', 'Wrong Part', 'Defective', 'Supplier Error']) {
      jest.clearAllMocks();
      wire({ receipt: { ...RECEIPT, workflow_status: 'Draft', bill_id: null } });
      const res = await request(app)
        .post('/api/goods-receipts/20/lines/501/return')
        .send({ return_quantity: 1, rejection_reason: reason });
      expect(res.status).toBe(200);
    }
  });

  test('"Other" carries the free-text explanation into the stored reason', async () => {
    wire({ receipt: { ...RECEIPT, workflow_status: 'Draft', bill_id: null } });
    await request(app)
      .post('/api/goods-receipts/20/lines/501/return')
      .send({ return_quantity: 1, rejection_reason: 'Other', notes: 'Wrong thread pitch' });

    const update = findCall('UPDATE goods_receipt_line');
    expect(update[1]).toContain('Other: Wrong thread pitch');
  });

  test('a line from another receipt is a 404', async () => {
    wire();
    const res = await request(app)
      .post('/api/goods-receipts/20/lines/999/return')
      .send({ return_quantity: 1, rejection_reason: 'Damaged' });
    expect(res.status).toBe(404);
  });
});
