import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMovementReference, formatDate, formatTimeOnly } from '../src/utils/cashDrawerFormatters.js';

test('formats invoice number slashed with physical receipt', () => {
    const item = {
        invoice_number: 'INV-202610-0001',
        physical_reference: 'DR-1234',
    };
    assert.equal(formatMovementReference(item), 'INV-202610-0001/DR-1234');
});

test('formats invoice number with invoice physical receipt', () => {
    const item = {
        invoice_number: 'INV-202610-0001',
        invoice_physical_receipt_no: 'DR-1234',
    };
    assert.equal(formatMovementReference(item), 'INV-202610-0001/DR-1234');
});

test('formats invoice number alone when no physical receipt', () => {
    const item = {
        invoice_number: 'INV-202610-0002',
    };
    assert.equal(formatMovementReference(item), 'INV-202610-0002');
});

test('does not duplicate when invoice number and physical reference are identical', () => {
    const item = {
        invoice_number: 'INV-202610-0003',
        physical_reference: 'inv-202610-0003',
    };
    assert.equal(formatMovementReference(item), 'INV-202610-0003');
});

test('formats physical reference alone (e.g. notebook receipt)', () => {
    const item = {
        physical_reference: 'NB-2026-0042',
    };
    assert.equal(formatMovementReference(item), 'NB-2026-0042');
});

test('formats credit note with invoice receipt', () => {
    const item = {
        cn_number: 'CN-202610-0005',
        physical_reference: 'DR-9988',
    };
    assert.equal(formatMovementReference(item), 'CN-202610-0005/DR-9988');
});

test('formats customer payment reference and receipt', () => {
    const item = {
        customer_payment_reference: 'PAY-1001',
        customer_payment_receipt_no: 'OR-5544',
    };
    assert.equal(formatMovementReference(item), 'PAY-1001/OR-5544');
});

test('formats expense reference', () => {
    const item = {
        expense_reference: 'EXP-8899',
    };
    assert.equal(formatMovementReference(item), 'EXP-8899');
});

test('formats ap payment reference', () => {
    const item = {
        ap_payment_reference: 'AP-4432',
    };
    assert.equal(formatMovementReference(item), 'AP-4432');
});

test('formats reversal reference fallback', () => {
    const item = {
        reversal_of: 45,
    };
    assert.equal(formatMovementReference(item), 'Reversal of #45');
});

test('returns em-dash when no reference information exists', () => {
    assert.equal(formatMovementReference({}), '—');
    assert.equal(formatMovementReference(null), '—');
    assert.equal(formatMovementReference(undefined), '—');
});

test('formatDate formats date in Asia/Manila time zone', () => {
    assert.equal(formatDate('2026-10-08T08:00:00Z'), '10/8/2026');
    assert.equal(formatDate('2026-10-08T16:00:00Z'), '10/9/2026');
    assert.equal(formatDate(null), '—');
    assert.equal(formatDate('invalid-date'), '—');
});

test('formatTimeOnly formats time in Asia/Manila time zone', () => {
    assert.equal(formatTimeOnly('2026-10-08T08:30:00Z'), '4:30:00 PM');
    assert.equal(formatTimeOnly('2026-10-08T16:30:00Z'), '12:30:00 AM');
    assert.equal(formatTimeOnly(null), '');
    assert.equal(formatTimeOnly('invalid-date'), '');
});
