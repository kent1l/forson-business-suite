import { getCustomerStatusBadge, getInvoiceStatusBadge } from '../src/utils/status.js';
import assert from 'node:assert';
import test from 'node:test';

test('getCustomerStatusBadge - handles missing due date', () => {
    const badge = getCustomerStatusBadge({});
    assert.deepStrictEqual(badge, { text: 'No due date', color: 'bg-gray-100 text-gray-800' });
});

test('getCustomerStatusBadge - handles future due date (> 7 days)', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const badge = getCustomerStatusBadge({ earliest_due_date: futureDate.toISOString() });
    assert.ok(badge.text.includes('days remaining'));
    assert.strictEqual(badge.color, 'bg-green-100 text-green-800');
});

test('getCustomerStatusBadge - handles past due date (overdue)', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const badge = getCustomerStatusBadge({ earliest_due_date: pastDate.toISOString() });
    assert.ok(badge.text.includes('days overdue'));
    assert.strictEqual(badge.color, 'bg-red-100 text-red-800');
});

test('getInvoiceStatusBadge - handles future invoice due date', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const badge = getInvoiceStatusBadge(futureDate.toISOString());
    assert.ok(badge.text.includes('remaining'));
    assert.strictEqual(badge.color, 'bg-green-100 text-green-800');
});
