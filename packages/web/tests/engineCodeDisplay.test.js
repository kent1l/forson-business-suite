import test from 'node:test';
import assert from 'node:assert/strict';
import { compressEngineCodes, formatEngineCodes, getEngineCodeDisplay } from '../src/utils/engineCodeDisplay.js';
import { compressEngineCodes as compatibilityExport, groupFitmentsForDisplay } from '../src/utils/engineCodeFormat.js';
import { formatApplicationText } from '../src/helpers/applicationTextHelper.js';

test('one reusable formatter returns safe shorthand and full atomic values', () => {
    const codes = [' 4be1 ', null, '4BC2', '4BE1', ''];
    assert.deepEqual(getEngineCodeDisplay(codes), { codes: ['4BC2', '4BE1'], text: '4BC2/E1', full: '4BC2, 4BE1', compressed: true });
    assert.equal(formatEngineCodes(codes), '4BC2/E1');
    assert.equal(formatEngineCodes(codes, { compact: false }), '4BC2, 4BE1');
    assert.equal(codes[0], ' 4be1 ');
    assert.equal(compatibilityExport, compressEngineCodes);
});

test('empty, single, incompatible and long lists use consistent fallbacks', () => {
    assert.equal(formatEngineCodes(), '');
    assert.equal(formatEngineCodes(null), '');
    assert.equal(formatEngineCodes('4be1'), '4BE1');
    assert.equal(formatEngineCodes(['4JA1-T', '4JA1']), '4JA1, 4JA1-T');
    assert.equal(formatEngineCodes(['4D10', '4D2']), '4D2, 4D10');
    assert.equal(formatEngineCodes(['4D59', '4D58', '4D57', '4D56', '4D55']), '4D55, 4D56, 4D57, 4D58, 4D59');
    assert.equal(formatEngineCodes(['1TR-FE', '4D56'], { separator: ' / ' }), '1TR-FE / 4D56');
});

test('linked-fitment groups deduplicate codes without losing per-link controls', () => {
    const base = { make: 'Isuzu', model: 'Elf', position: 'Front', chassis: 'NKR' };
    const [group] = groupFitmentsForDisplay([{ ...base, engine: '4BE1', rule_id: 1 }, { ...base, engine: '4BC2', rule_id: 2 }, { ...base, engine: '4BE1', rule_id: 3 }]);
    assert.equal(group.engineDisplay, '4BC2/E1');
    assert.deepEqual(group.engineCodes, ['4BC2', '4BE1']);
    assert.equal(group.fitments.length, 3);
    assert.equal(groupFitmentsForDisplay([{ ...base, model_id: 1, engine: '4BC2' }, { ...base, model_id: 2, engine: '4BE1' }]).length, 2);
    assert.equal(groupFitmentsForDisplay([{ ...base, engine: '4BC2' }, base]).length, 2);
});

test('legacy formatting preserves qualifier/year contexts and mixed engine-only rows', () => {
    const out = formatApplicationText([
        { make: 'Isuzu', model: 'Elf', engine: '4BC2', year_start: 1990, transmission: 'Manual' },
        { make: 'Isuzu', model: 'Elf', engine: '4BE1', year_start: 2000, transmission: 'Automatic' },
        { engine: '4JA1' },
    ], { mergeModelsByMake: true });
    assert.ok(out.includes('Manual') && out.includes('Automatic') && out.includes('4JA1'));
    assert.ok(!out.includes('4BC2/E1'));
    const collapsed = formatApplicationText([
        { make: 'Isuzu', model: 'Elf', engine: '4BC2', year_start: 1990 },
        { make: 'Isuzu', model: 'Elf', engine: '4BE1', year_start: 2000 },
    ], { collapseDuplicateEngines: true });
    assert.ok(!collapsed.includes('4BC2/E1'));
    assert.ok(collapsed.includes('1990') && collapsed.includes('2000'));
    const first = formatApplicationText([{ application_id: 991, make: 'Isuzu', model: 'Elf', engine: '4BC2' }]);
    const updated = formatApplicationText([{ application_id: 991, make: 'Isuzu', model: 'Elf', engine: '4BE1' }]);
    assert.ok(first.includes('4BC2') && updated.includes('4BE1'));
});
