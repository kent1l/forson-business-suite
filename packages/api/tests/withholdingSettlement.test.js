const request = require('supertest');
const express = require('express');

const clientQuery = jest.fn();
jest.mock('../db', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    getClient: jest.fn(),
}));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 10 }; next(); },
    hasPermission: () => (req, res, next) => next(),
}));

jest.mock('../services/customerWalletService', () => ({
    getWallet: jest.fn(),
    appendWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/arLedgerService', () => ({
    appendEntry: jest.fn().mockResolvedValue(1),
}));

const db = require('../db');
const arLedger = require('../services/arLedgerService');

/**
 * Tax withheld at source settles a receivable without any cash arriving. That makes
 * it the one settlement channel that can reduce a customer's balance with nothing
 * received, so these tests are about the guards around it rather than the arithmetic.
 */
describe('withholding at AR collection', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api', require('../routes/paymentRoutes'));
    });

    // The route issues a long, order-sensitive chain of queries, most of which are
    // irrelevant here. Rather than queue two dozen mockResolvedValueOnce calls and
    // re-count them every time the route changes, the harness answers by statement
    // shape and lets each test override only the rows it actually cares about.
    let invoiceContext;

    const respondTo = (sql) => {
        if (/FROM payment_methods/.test(sql)) {
            return { rows: [{ method_id: 1, code: 'cash', name: 'Cash', type: 'cash', config: {} }] };
        }
        if (/INSERT INTO customer_payment/.test(sql)) return { rows: [{ payment_id: 500 }] };
        if (/FROM invoice i\s+JOIN customer c/.test(sql)) {
            return { rows: [{
                invoice_id: 7, invoice_number: 'INV-7',
                total_amount: invoiceContext.total, customer_id: invoiceContext.customerId,
                is_withholding_agent: invoiceContext.isAgent, customer_type: invoiceContext.customerType,
            }] };
        }
        if (/FROM invoice_line il/.test(sql)) {
            return { rows: [{ part_id: 1, tax_base: invoiceContext.base, is_service: false }] };
        }
        if (/FROM settings/.test(sql)) return { rows: [] };  // statutory defaults
        if (/SUM\(actual_withheld\)/.test(sql)) return { rows: [{ total: invoiceContext.alreadyWithheld }] };
        if (/FROM invoice i\s+LEFT JOIN invoice_payment_allocation/.test(sql)) {
            return { rows: [{ total_amount: invoiceContext.total, already_allocated: 0, total_allocated: 11200 }] };
        }
        if (/INSERT INTO withholding_tax_line/.test(sql)) return { rows: [{ wt_line_id: 900 }] };
        return { rows: [] };
    };

    beforeEach(() => {
        jest.clearAllMocks();
        invoiceContext = {
            customerId: 3, customerType: 'GOVERNMENT', isAgent: true,
            base: 10000, total: 11200, alreadyWithheld: 0,
        };
        clientQuery.mockReset();
        clientQuery.mockImplementation((sql) => Promise.resolve(respondTo(String(sql))));
        db.getClient.mockResolvedValue({ query: clientQuery, release: jest.fn() });
    });

    const post = (body) => request(app).post('/api/payments').send({
        customer_id: 3, amount: 10600, method_id: 1,
        allocations: [{ invoice_id: 7, amount_allocated: 10600 }],
        ...body,
    });

    test('rejects withholding for a customer who is not a designated agent', async () => {
        invoiceContext.isAgent = false;
        invoiceContext.customerType = 'PRIVATE';

        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });

        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/only be recorded for customers marked as withholding agents/);
        expect(clientQuery.mock.calls.map(c => c[0])).toContain('ROLLBACK');
        expect(arLedger.appendEntry).not.toHaveBeenCalled();
    });

    test('rejects a deduction larger than any plausible mis-computation', async () => {

        // Government: 1% EWT + 5% VAT on a 10,000 base = 600. The ceiling is that
        // scaled to the VAT-inclusive total, 672. 5,000 is somebody writing off a debt.
        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 5000 }] });

        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/exceeds the most that could plausibly be withheld/);
        expect(arLedger.appendEntry).not.toHaveBeenCalled();
    });

    test('accepts the over-withholding customers actually commit', async () => {

        // 6% of the VAT-inclusive 11,200 rather than of the 10,000 base: wrong, but
        // routine, and the receivable really was settled by that much. The cash they
        // send is the invoice net of what they took, so it moves with the deduction.
        const res = await post({
            amount: 10528,
            allocations: [{ invoice_id: 7, amount_allocated: 10528 }],
            withholding: [{ invoice_id: 7, amount_withheld: 672 }],
        });

        expect(res.status).toBe(201);
        expect(res.body.withheld_amount).toBe(672);
        expect(res.body.allocated_amount).toBe(11200);
    });

    test('will not let a second collection withhold against the same base again', async () => {
        invoiceContext.alreadyWithheld = 600;

        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });

        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/already recorded/);
    });

    test('rejects withholding against another customer\'s invoice', async () => {
        invoiceContext.customerId = 99;

        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });

        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/does not belong to this customer/);
    });

    test('posts cash and withholding as separate ledger entries', async () => {

        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });
        expect(res.status).toBe(201);

        const entries = arLedger.appendEntry.mock.calls.map(c => c[1]);
        const cash = entries.find(e => e.entryType === 'PAYMENT_SETTLED');
        const withheld = entries.find(e => e.entryType === 'WITHHOLDING_TAX_CREDIT');

        // The invoice was settled for 11,200: 10,600 in cash and 600 by certificate.
        // Reporting the whole 11,200 as PAYMENT_SETTLED would overstate collections.
        expect(cash.amount).toBe(-10600);
        expect(withheld.amount).toBe(-600);
        expect(Math.round((cash.amount + withheld.amount) * 100) / 100).toBe(-11200);
    });

    test('settles the invoice for cash plus withholding, not cash alone', async () => {

        await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });

        const allocationInsert = clientQuery.mock.calls
            .find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO invoice_payment_allocation'));
        expect(allocationInsert).toBeDefined();
        expect(allocationInsert[1][2]).toBe(11200);
    });

    test('does not credit the withheld amount to the store wallet as an overpayment', async () => {

        const res = await post({ withholding: [{ invoice_id: 7, amount_withheld: 600 }] });

        // Allocations total 11,200 against 10,600 cash. Measuring the excess against
        // the allocation total would read as a 600 overpayment and quietly hand the
        // customer store credit for tax they never paid us.
        expect(res.body.overpayment_credited).toBe(0);
    });

    test('leaves an ordinary payment with no withholding untouched', async () => {

        const res = await post({});

        expect(res.status).toBe(201);
        expect(res.body.withheld_amount).toBe(0);
        const entries = arLedger.appendEntry.mock.calls.map(c => c[1]);
        expect(entries).toHaveLength(1);
        expect(entries[0].entryType).toBe('PAYMENT_SETTLED');
        expect(entries[0].amount).toBe(-10600);
    });
});
