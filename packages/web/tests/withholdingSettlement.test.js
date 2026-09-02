import { allocateCash, withheldFor, cashCapFor } from '../src/utils/withholdingSettlement.js';
import assert from 'node:assert';
import test from 'node:test';

// The invoice from the reported bug: balance 1,950.00 on a VAT-exclusive base of
// 1,741.07, so a 1% deduction is 17.41 and the net cheque would be 1,932.59.
const invoice = { invoice_id: 2, balance_due: 1950.00 };
const expected = { remaining_expected: 17.41, ceiling: 19.50 };
const expectedByInvoice = { '2': expected };

test('cash cap is the balance less the expected deduction', () => {
    assert.strictEqual(cashCapFor(invoice, expected), 1932.59);
});

test('an invoice with no withholding caps at its full balance', () => {
    assert.strictEqual(cashCapFor(invoice, undefined), 1950.00);
});

test('a net cheque settles the invoice in full, cash plus tax', () => {
    const alloc = allocateCash([invoice], 1932.59, expectedByInvoice);
    const cash = alloc[2];
    const withheld = withheldFor(invoice, expected, cash);

    assert.strictEqual(cash, 1932.59);
    assert.strictEqual(withheld, 17.41);
    assert.strictEqual(Math.round((cash + withheld) * 100) / 100, 1950.00);
});

test('paying the full balance in cash withholds nothing and is not an overpayment', () => {
    // The reported bug: 1,950 cash left 17.41 stranded, which the form offered to
    // deposit into the customer's store wallet as credit for tax never withheld.
    const alloc = allocateCash([invoice], 1950.00, expectedByInvoice);
    const cash = alloc[2];
    const withheld = withheldFor(invoice, expected, cash);

    assert.strictEqual(cash, 1950.00, 'all cash must reach the invoice');
    assert.strictEqual(withheld, 0, 'nothing was withheld, so nothing may be recorded');
    assert.strictEqual(Math.round((cash + withheld) * 100) / 100, 1950.00);
});

test('cash and tax together never exceed the balance', () => {
    for (const amount of [0, 100, 900, 1500, 1932.59, 1940, 1950]) {
        const alloc = allocateCash([invoice], amount, expectedByInvoice);
        const cash = alloc[2] || 0;
        const settled = Math.round((cash + withheldFor(invoice, expected, cash)) * 100) / 100;
        assert.ok(settled <= 1950.00 + 0.001, `settled ${settled} exceeds the balance at cash ${amount}`);
    }
});

test('a partial payment withholds proportionally, not in full', () => {
    // Half the net requirement: they are clearing half the bill, so they deduct on half.
    const alloc = allocateCash([invoice], 966.30, expectedByInvoice);
    const withheld = withheldFor(invoice, expected, alloc[2]);

    assert.strictEqual(withheld, 8.71);
    assert.ok(withheld < expected.remaining_expected);
});

test('no cash applied means no deduction', () => {
    assert.strictEqual(withheldFor(invoice, expected, 0), 0);
});

test('one net cheque across several invoices fills each to its own net requirement', () => {
    // Filling the first invoice to its GROSS balance would take 11,200 of the 15,900
    // and leave the second invoice short by exactly the tax withheld on the first.
    const a = { invoice_id: 1, balance_due: 11200 };
    const b = { invoice_id: 2, balance_due: 5600 };
    const exp = { '1': { remaining_expected: 600 }, '2': { remaining_expected: 300 } };

    const alloc = allocateCash([a, b], 15900, exp);

    assert.strictEqual(alloc[1], 10600);
    assert.strictEqual(alloc[2], 5300);
    assert.strictEqual(withheldFor(a, exp['1'], alloc[1]), 600);
    assert.strictEqual(withheldFor(b, exp['2'], alloc[2]), 300);
    // Both invoices fully settled: 11,200 and 5,600.
    assert.strictEqual(alloc[1] + withheldFor(a, exp['1'], alloc[1]), 11200);
    assert.strictEqual(alloc[2] + withheldFor(b, exp['2'], alloc[2]), 5600);
});

test('surplus cash tops up towards the gross balance before becoming an overpayment', () => {
    const a = { invoice_id: 1, balance_due: 11200 };
    const exp = { '1': { remaining_expected: 600 } };

    // They withheld nothing and paid both invoices' gross value.
    const alloc = allocateCash([a], 11200, exp);
    assert.strictEqual(alloc[1], 11200);
    assert.strictEqual(withheldFor(a, exp['1'], alloc[1]), 0);
});

test('genuine overpayment is still left over', () => {
    const alloc = allocateCash([invoice], 2000, expectedByInvoice);
    const cash = alloc[2];
    // 1,950 lands on the invoice; the remaining 50 is a real overpayment and is not
    // forced onto an invoice that does not owe it.
    assert.strictEqual(cash, 1950.00);
    assert.strictEqual(Math.round((2000 - cash) * 100) / 100, 50.00);
});

test('an ordinary customer is unaffected', () => {
    const alloc = allocateCash([invoice], 1000, {});
    assert.strictEqual(alloc[2], 1000);
    assert.strictEqual(withheldFor(invoice, undefined, 1000), 0);
});
