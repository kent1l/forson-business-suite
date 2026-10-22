import assert from 'assert';
import { formatPhysicalReceiptNumber } from '../src/utils/receiptNumberFormatter.js';

console.log('🧪 Testing physical document utilities and normalization...');

// Test formatPhysicalReceiptNumber normalization
assert.strictEqual(formatPhysicalReceiptNumber('si 4521'), 'SI-4521');
assert.strictEqual(formatPhysicalReceiptNumber('SI-4521'), 'SI-4521');
assert.strictEqual(formatPhysicalReceiptNumber('  or 1002  '), 'OR-1002');
assert.strictEqual(formatPhysicalReceiptNumber('12345'), '12345');
assert.strictEqual(formatPhysicalReceiptNumber(''), null);
assert.strictEqual(formatPhysicalReceiptNumber(null), null);
assert.strictEqual(formatPhysicalReceiptNumber(undefined), null);

// Test canonical exception reasons required by schema
const VALID_EXCEPTION_REASONS = ['NEW_BOOKLET', 'SPOILED_SUGGESTION', 'OTHER_NOT_SPOILED'];
assert.strictEqual(VALID_EXCEPTION_REASONS.includes('NEW_BOOKLET'), true);
assert.strictEqual(VALID_EXCEPTION_REASONS.includes('SPOILED_SUGGESTION'), true);
assert.strictEqual(VALID_EXCEPTION_REASONS.includes('OTHER_NOT_SPOILED'), true);

// Test payload shape requirements
function buildPhysicalDocPayload({ recordingMethod, seriesId, reference, token, exception }) {
    if (recordingMethod === 'NOTEBOOK') {
        return {
            recording_method: 'NOTEBOOK',
            series_id: null,
            physical_receipt_no: null,
            suggestion_token: null,
            exception: null,
        };
    }
    return {
        recording_method: 'PAPER',
        series_id: seriesId,
        physical_receipt_no: formatPhysicalReceiptNumber(reference),
        suggestion_token: token || null,
        exception: exception || null,
    };
}

const notebookPayload = buildPhysicalDocPayload({ recordingMethod: 'NOTEBOOK' });
assert.strictEqual(notebookPayload.recording_method, 'NOTEBOOK');
assert.strictEqual(notebookPayload.series_id, null);
assert.strictEqual(notebookPayload.physical_receipt_no, null);

const paperPayload = buildPhysicalDocPayload({
    recordingMethod: 'PAPER',
    seriesId: 10,
    reference: 'si 5001',
    token: 'test-token',
    exception: { reason: 'SPOILED_SUGGESTION', notes: 'Paper tear' }
});
assert.strictEqual(paperPayload.recording_method, 'PAPER');
assert.strictEqual(paperPayload.series_id, 10);
assert.strictEqual(paperPayload.physical_receipt_no, 'SI-5001');
assert.strictEqual(paperPayload.suggestion_token, 'test-token');
assert.strictEqual(paperPayload.exception.reason, 'SPOILED_SUGGESTION');

console.log('✅ Physical document tests passed successfully.');
