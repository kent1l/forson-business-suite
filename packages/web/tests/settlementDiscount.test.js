import { maxDiscountFor, discountToSettle, validateDiscounts, discountsPayload } from '../src/utils/settlementDiscount.js';
import assert from 'node:assert';
import test from 'node:test';

// The case this whole feature exists for: a trade customer owes 12,800, the
// owner takes 12,000 in cash today and forgives the remaining 800 to close it.
const invoice = { invoice_id: 991, invoice_number: 'INV-202608-0142', balance_due: 12800.00 };

const PROMPT = { reason_code: 'PROMPT_SETTLEMENT', label: 'Prompt Settlement Discount', max_amount: null, requires_note: false };
const ROUNDING = { reason_code: 'ROUNDING', label: 'Rounding / Centavo Adjustment', max_amount: 1.00, requires_note: false };
const DISPUTE = { reason_code: 'DISPUTE_CONCESSION', label: 'Dispute Concession', max_amount: null, requires_note: true };

test('the settle shortcut fills exactly what the cash leaves owing', () => {
    assert.strictEqual(discountToSettle(invoice, 12000), 800.00);
});

test('cash covering the whole balance leaves nothing to forgive', () => {
    assert.strictEqual(maxDiscountFor(invoice, 12800), 0);
    assert.strictEqual(discountToSettle(invoice, 12800), 0);
});

test('an over-payment never produces a negative ceiling', () => {
    assert.strictEqual(maxDiscountFor(invoice, 13000), 0);
});

test('withholding is taken first and the discount only gets what is left', () => {
    // 12,800 gross, 114.29 withheld at source, 12,000 cash counted. The
    // concession may be 685.71 -- never 800, which would have eaten into the
    // tax the customer already remitted to BIR under our TIN.
    const room = maxDiscountFor(invoice, 12000, 114.29);
    assert.strictEqual(room, 685.71);
    assert.strictEqual(Math.round((12000 + 114.29 + room) * 100) / 100, 12800.00);
});

test('cash plus tax plus discount never exceeds the balance', () => {
    const { problems } = validateDiscounts([invoice], { 991: 800.01 }, {
        cashByInvoice: { 991: 12000 },
        reason: PROMPT,
    });
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /INV-202608-0142/);
});

test('the exact settling amount is accepted', () => {
    const { total, problems } = validateDiscounts([invoice], { 991: 800 }, {
        cashByInvoice: { 991: 12000 },
        reason: PROMPT,
    });
    assert.strictEqual(total, 800);
    assert.deepStrictEqual(problems, []);
});

test('a concession with no reason is refused', () => {
    const { problems } = validateDiscounts([invoice], { 991: 800 }, {
        cashByInvoice: { 991: 12000 },
        reason: null,
    });
    assert.deepStrictEqual(problems, ['Choose a reason for the concession.']);
});

test('the rounding bucket cannot absorb a real concession', () => {
    const { problems } = validateDiscounts([invoice], { 991: 800 }, {
        cashByInvoice: { 991: 12000 },
        reason: ROUNDING,
    });
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /capped/);
});

test('a rounding residue under the cap is fine', () => {
    const centavo = { invoice_id: 7, invoice_number: 'INV-7', balance_due: 1500.45 };
    const { total, problems } = validateDiscounts([centavo], { 7: 0.45 }, {
        cashByInvoice: { 7: 1500.00 },
        reason: ROUNDING,
    });
    assert.strictEqual(total, 0.45);
    assert.deepStrictEqual(problems, []);
});

test('a reason that requires a note is refused without one', () => {
    const { problems } = validateDiscounts([invoice], { 991: 800 }, {
        cashByInvoice: { 991: 12000 },
        reason: DISPUTE,
        notes: 'short',
    });
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /at least 10 characters/);
});

test('no concession entered means no reason is demanded', () => {
    const { total, problems } = validateDiscounts([invoice], {}, {
        cashByInvoice: { 991: 12000 },
        reason: null,
    });
    assert.strictEqual(total, 0);
    assert.deepStrictEqual(problems, []);
});

test('concessions across several invoices add up to the document total', () => {
    const a = { invoice_id: 887, invoice_number: 'INV-887', balance_due: 4200 };
    const b = { invoice_id: 902, invoice_number: 'INV-902', balance_due: 1150 };
    const { total, byInvoice, problems } = validateDiscounts([a, b], { 887: 4200, 902: 1150 }, { reason: PROMPT });

    assert.strictEqual(total, 5350);
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(discountsPayload(byInvoice), [
        { invoice_id: 887, amount: 4200 },
        { invoice_id: 902, amount: 1150 },
    ]);
});

test('the payload drops zeroes rather than sending empty allocations', () => {
    assert.deepStrictEqual(discountsPayload({ 1: 0, 2: 25.5, 3: '' }), [{ invoice_id: 2, amount: 25.5 }]);
});
