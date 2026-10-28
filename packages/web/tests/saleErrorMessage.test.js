import assert from 'node:assert/strict';
import test from 'node:test';
import { getSaleErrorMessage } from '../src/utils/saleErrorMessage.js';

test('checkout displays the API reason for duplicate receipts and other validation failures', () => {
    for (const status of [400, 409, 422]) {
        const message = status === 409
            ? 'Physical receipt number SI-123 is already issued. Choose an unused receipt number.'
            : 'Receipt exception reason is required when deviating from suggested number.';
        assert.equal(getSaleErrorMessage({ response: { status, data: { message } } }, 'Fallback'), message);
    }
});

test('checkout handles alternate error fields, preflight errors and missing server messages', () => {
    assert.equal(getSaleErrorMessage({ response: { data: { error: 'Receipt is spoiled.' } } }, 'Fallback'), 'Receipt is spoiled.');
    assert.equal(getSaleErrorMessage(new Error('Resolve the previous cash payment.'), 'Fallback'), 'Resolve the previous cash payment.');
    assert.equal(getSaleErrorMessage({ isAxiosError: true, message: 'Network Error' }, 'Please try again.'), 'Please try again.');
    assert.equal(getSaleErrorMessage({ response: { data: { message: {}, error: '  ' } } }, 'Fallback'), 'Fallback');
    assert.equal(getSaleErrorMessage(null, 'Fallback'), 'Fallback');
});
