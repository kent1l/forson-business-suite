import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptDateForInput, receiptDateForPayload } from '../src/utils/grnReceiptDate.js';

test('GRN received date uses the Manila day of an API timestamp', () => {
    assert.equal(receiptDateForInput('2026-10-20T16:00:00.000Z'), '2026-10-21');
    assert.equal(receiptDateForInput('2026-10-21T15:59:59.999Z'), '2026-10-21');
    assert.equal(receiptDateForInput('2026-10-21T16:00:00.000Z'), '2026-10-22');
    assert.equal(receiptDateForInput('2026-10-21'), '2026-10-21');
});

test('repeated GRN draft save/reopen cycles preserve dates across month and year boundaries', () => {
    for (const selected of ['2026-10-21', '2026-01-01', '2026-03-01', '2024-02-29']) {
        let received = selected;
        for (let cycle = 0; cycle < 5; cycle += 1) {
            const payload = receiptDateForPayload(received);
            assert.equal(payload, `${selected}T00:00:00+08:00`);
            // PostgreSQL timestamptz responses are serialized to UTC by the API.
            received = receiptDateForInput(new Date(payload).toISOString());
            assert.equal(received, selected);
        }
    }
});

test('an unspecified received date stays optional', () => {
    assert.equal(receiptDateForPayload(''), null);
    assert.equal(receiptDateForInput(null), '');
    assert.equal(receiptDateForInput(undefined), '');
});
