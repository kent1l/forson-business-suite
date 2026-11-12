import test from 'node:test';
import assert from 'node:assert/strict';
import { getGrnPartNumbers, importRowMatchKey, GRN_EXTRACTION_PROMPT } from '../src/utils/grnImportReview.js';

test('compiles primary and additional numbers in order without losing identifier punctuation', () => {
    const source = { part_number: '00123-A', part_numbers: ['00123-a', ' X/456 ', '789-B'] };
    assert.deepEqual(getGrnPartNumbers(source), ['00123-A', 'X/456', '789-B']);
    assert.equal(getGrnPartNumbers(source).join('; '), '00123-A; X/456; 789-B');
    assert.deepEqual(getGrnPartNumbers({ part_number: 'LEGACY-01' }), ['LEGACY-01']);
    assert.deepEqual(getGrnPartNumbers({ part_numbers: ['ARRAY-01', 'ARRAY-02'] }), ['ARRAY-01', 'ARRAY-02']);
    assert.deepEqual(getGrnPartNumbers({}), []);
});

test('changing an additional part number invalidates the automatic matching key', () => {
    const review = { source_payload: { lines: [{ line_no: 1, supplier_item_text: 'Oil filter', part_numbers: ['A', 'B'] }] } };
    const row = { row_id: 'r1', line_no: 1 };
    const first = importRowMatchKey(review, row);
    review.source_payload.lines[0].part_numbers[1] = 'C';
    assert.notEqual(importRowMatchKey(review, row), first);
});

test('the extractor JSON template includes separate source and research lists', () => {
    const json = GRN_EXTRACTION_PROMPT.match(/```json\n([\s\S]*?)\n```/)[1];
    const template = JSON.parse(json);
    assert.deepEqual(template.lines[0].part_numbers, []);
    assert.deepEqual(template.lines[0].enrichment.suggested_part_numbers, []);
});
