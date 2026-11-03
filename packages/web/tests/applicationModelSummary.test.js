import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeApplicationModel } from '../src/helpers/applicationModelSummary.js';

test('model summary keeps discontinuous years and omits missing qualifiers', () => {
    const rows = [
        { chassis: 'A', engine: '4D55', year_start: 1990, year_end: 1995, transmission: 'Manual' },
        { chassis: 'B', engine: '4D56', year_start: 2000, year_end: 2005 },
        { chassis: 'B', engine: null, year_start: 2000, year_end: 2005 },
    ];
    const before = structuredClone(rows);
    const result = summarizeApplicationModel(rows);
    assert.deepEqual(result.chassis, ['A', 'B']);
    assert.equal(result.engineText, '4D55/6');
    assert.deepEqual(result.engines, ['4D55', '4D56']);
    assert.deepEqual(result.classifications.find(item => item.label === 'Years').values, ["1990–'95", "2000–'05"]);
    assert.deepEqual(result.classifications.find(item => item.label === 'Transmission').values, ['Manual']);
    assert.deepEqual(rows, before);
});

test('unsafe shorthand falls back to full codes and duplicate values appear once', () => {
    const result = summarizeApplicationModel([
        { engine: '4JA1', chassis: 'NKR', variant_descriptor: 'GL' },
        { engine: '4JA1-T', chassis: 'NKR', variant: 'GL' },
        { engine: '4JA1', chassis: 'NKR', variant: 'GL' },
    ]);
    assert.equal(result.engineText, '4JA1, 4JA1-T');
    assert.deepEqual(result.chassis, ['NKR']);
    assert.deepEqual(result.classifications, [{ label: 'Variant', values: ['GL'] }]);
});
