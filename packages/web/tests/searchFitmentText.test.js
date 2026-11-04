import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchFitments } from '../src/helpers/searchFitmentText.js';

const base = { make: 'Isuzu', make_id: 1, model: 'Elf', model_id: 2, chassis: 'NKR', transmission: 'Manual', year_start: 1990, year_end: 1995 };
const pair = [{ ...base, engine: '4BC2' }, { ...base, engine: '4BE1' }];

test('search fitments reuse safe shorthand within one model and exact context', () => {
    const rows = structuredClone(pair);
    const out = formatSearchFitments({ fitment_rules: rows, applications: 'stale index label' });
    assert.equal(out, 'Isuzu Elf (4BC2/E1 · Chassis: NKR · 90-95 · Manual)');
    assert.deepEqual(rows, pair);
    assert.ok(!out.includes('stale'));
    const full = formatSearchFitments({ fitment_rules: pair }, { compact: false });
    assert.ok(full.includes('4BC2, 4BE1') && full.includes('1990-1995'));
});

test('different chassis, years, classifications and exclusions retain their own contexts', () => {
    const rows = [pair[0], { ...pair[1], chassis: 'NPR', transmission: 'Automatic', year_start: 2000, year_end: 2005 }, { ...pair[1], effect: 'exclude' }];
    const out = formatSearchFitments({ fitment_rules: rows }, { multiline: true });
    assert.ok(out.includes('4BC2 · Chassis: NKR · 90-95 · Manual; 4BE1 · Chassis: NPR · 00-05 · Automatic'));
    assert.ok(out.includes('\nExcluded: Isuzu Elf (4BE1'));
    assert.ok(!out.includes('4BC2/E1'));
});

test('model and make identity prevent combining engine codes across vehicles', () => {
    const out = formatSearchFitments({ fitment_rules: [pair[0], { ...pair[1], make: 'Other', make_id: 3, model_id: 4 }] });
    assert.ok(out.includes('Isuzu Elf (4BC2'));
    assert.ok(out.includes('Other Elf (4BE1'));
    assert.ok(!out.includes('4BC2/E1'));
});

test('only available details display while unsafe variant compression stays separate', () => {
    const out = formatSearchFitments({ fitment_rules: [{ engine: '4JA1' }, { engine: '4JA1-T' }, { ...base }, ...pair] });
    assert.ok(out.includes('; 4JA1, 4JA1-T'));
    assert.ok(!out.includes('not specified'));
    assert.ok(out.includes('4BC2/E1'));
});

test('partial fitments omit missing-detail labels and empty punctuation', () => {
    for (const compact of [true, false]) {
        assert.equal(formatSearchFitments({ fitment_rules: [{ make: 'Isuzu', model: 'Elf' }] }, { compact }), 'Isuzu Elf');
        assert.equal(formatSearchFitments({ fitment_rules: [{ engine: '4BE1' }] }, { compact }), '4BE1');
        assert.equal(formatSearchFitments({ fitment_rules: [{ chassis: 'NKR' }] }, { compact }), 'Chassis: NKR');
        assert.equal(formatSearchFitments({ fitment_rules: [{ make: 'Isuzu' }] }, { compact }), 'Isuzu');
        assert.equal(formatSearchFitments({ fitment_rules: [{ engine: '4BE1', effect: 'exclude' }] }, { compact }), 'Excluded: 4BE1');
    }
});

test('qualifier modes keep apparently identical contexts separate', () => {
    const out = formatSearchFitments({ fitment_rules: [{ ...pair[0], engine_mode: 'specified' }, { ...pair[1], engine_mode: 'unknown' }] });
    assert.ok(!out.includes('4BC2/E1'));
});

test('legacy opaque labels are preserved without guessing their structure', () => {
    assert.equal(formatSearchFitments({ applications: ['Toyota Hilux 1KD-FTV', { display: 'Isuzu Elf 4BE1' }] }), 'Isuzu Elf 4BE1; Toyota Hilux 1KD-FTV');
    assert.equal(formatSearchFitments({ applications: 'Legacy label; do not parse' }), 'Legacy label; do not parse');
    assert.equal(formatSearchFitments({ fitment_rules: [], applications: 'stale label' }), '');
    assert.equal(formatSearchFitments({}), '');
});

test('same application ID with different effective link details is not cached as one label', () => {
    const first = formatSearchFitments({ fitment_rules: [{ ...pair[0], application_id: 1, position: 'Front' }] });
    const next = formatSearchFitments({ fitment_rules: [{ ...pair[0], application_id: 1, position: 'Rear' }] });
    assert.ok(first.startsWith('Front · Isuzu Elf') && next.startsWith('Rear · Isuzu Elf'));
    assert.ok(!next.includes('Front'));
});

test('display order is position, make, model, engine, chassis, years and narrower details', () => {
    const rows = [
        { make: 'Toyota', model: 'Hilux', engine: '2KD-FTV' },
        { make: 'Isuzu', model: 'Elf', engine: '4D10', chassis: 'NKR10' },
        { make: 'Isuzu', model: 'D-Max', engine: '4JJ1' },
        { make: 'Isuzu', model: 'Elf', engine: '4D2', chassis: 'NKR2', year_start: 2005, year_end: 2015,
            generation: 'Gen 2', variant: 'GL', drivetrain: '4WD', transmission: 'Manual',
            fuel_type: 'diesel', displacement_liters: 2.5, market: 'PH', position: 'Front' },
        { engine: '4BE1' },
    ];
    const out = formatSearchFitments({ fitment_rules: rows });
    assert.equal(out, 'Front · Isuzu Elf (4D2 · Chassis: NKR2 · 05-15 · Generation: Gen 2 · GL · 4WD · Manual · diesel · 2.5L · PH); Isuzu D-Max (4JJ1); Isuzu Elf (4D10 · Chassis: NKR10); Toyota Hilux (2KD-FTV); 4BE1');
    assert.equal(formatSearchFitments({ fitment_rules: [...rows].reverse() }), out);
    assert.equal(rows[0].make, 'Toyota');
});

test('different fitting positions remain separate before each vehicle identity', () => {
    const rows = [{ ...pair[1], position: 'Rear Right' }, { ...pair[0], position: 'Front Left' }];
    for (const compact of [true, false]) {
        const out = formatSearchFitments({ fitment_rules: rows }, { compact });
        assert.ok(out.startsWith('Front Left · Isuzu Elf (4BC2'));
        assert.ok(out.includes('; Rear Right · Isuzu Elf (4BE1'));
        assert.ok(!out.includes('4BC2/E1'));
        assert.equal((out.match(/Front Left/g) || []).length, 1);
    }
});
