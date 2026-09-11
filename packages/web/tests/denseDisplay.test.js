import test from 'node:test';
import assert from 'node:assert/strict';

import { formatYears } from '../src/utils/yearShorthand.js';
import { formatApplicationText } from '../src/helpers/applicationTextHelper.js';
import { __setDictionaryForTests, __resetDictionaryForTests } from '../src/helpers/displayDictionary.js';

// Dense fitment display, Vehicle Fitment Phase 10 (PRD-FBS-FIT-002 §10).
//
// The dictionary is stubbed rather than fetched, so these exercise the real
// formatter end to end without a network.

const PART = [
  { make: 'Toyota', model: 'Hilux', engine: '2KD-FTV', year_start: 2005, year_end: 2015 },
  { make: 'Toyota', model: 'Hilux', engine: '1KD-FTV', year_start: 2005, year_end: 2015 },
  { make: 'Mitsubishi', model: 'L300', engine: '4D55', year_start: 1995, year_end: 2010 },
  { make: 'Mitsubishi', model: 'L300', engine: '4D56', year_start: 1995, year_end: 2010 },
];

const withDictionary = () => __setDictionaryForTests({
  makes: { Mitsubishi: 'Mits', 'UD Trucks / Nissan Diesel': 'UD' },
  models: { 'Land Cruiser Prado': 'Prado' },
  engines: {},
  // Exactly what the real catalog reports.
  ambiguousModels: ['ranger', 'rosa'],
});

test('formats a full year range', () => {
  assert.equal(formatYears(2005, 2015), '2005-2015');
});

test('shortens a range to two-digit notation', () => {
  assert.equal(formatYears(2005, 2015, { short: true }), '05-15');
});

test('collapses a single-year range to one value', () => {
  assert.equal(formatYears(2015, 2015), '2015');
  assert.equal(formatYears(2015, 2015, { short: true }), '15');
});

test('handles an open-ended range', () => {
  assert.equal(formatYears(2015, null), '2015+');
  assert.equal(formatYears(2015, null, { short: true }), '15+');
});

test('handles an end-only range', () => {
  assert.equal(formatYears(null, 2018), 'up to 2018');
  assert.equal(formatYears(null, 2018, { short: true }), '≤18');
});

test('spans the century boundary consistently with the parser pivot', () => {
  // 1995 -> 95 and 2010 -> 10, matching expandTwoDigitYear's 70/00 pivot in
  // packages/api/helpers/fitmentTextParser.js, so a shortened range typed back
  // in resolves to the same years.
  assert.equal(formatYears(1995, 2010, { short: true }), '95-10');
});

test('refuses to shorten years that would round-trip to the wrong century', () => {
  // 1965 would shorten to "65", which the pivot reads back as 2065.
  assert.equal(formatYears(1965, 1975, { short: true }), '1965-1975');
});

test('does not half-shorten a range containing an unsafe year', () => {
  const out = formatYears(1968, 2010, { short: true });
  assert.equal(out, '1968-2010');
  assert.ok(!out.includes('68-10'));
});

test('returns empty for a range with no years at all', () => {
  assert.equal(formatYears(null, null), '');
  assert.equal(formatYears('', '', { short: true }), '');
});

test('tolerates string year values from form inputs', () => {
  assert.equal(formatYears('2005', '2015', { short: true }), '05-15');
});

test('dense mode drops the make when the model name is unique to it', () => {
  withDictionary();
  const out = formatApplicationText(PART, { style: 'tableCell', dense: true, cache: false });
  assert.ok(out.includes('Hilux'), out);
  assert.ok(!out.includes('Toyota'), `make should be dropped: ${out}`);
  __resetDictionaryForTests();
});

test('dense mode KEEPS the make for a model name two makes share', () => {
  withDictionary();
  const apps = [
    { make: 'Ford', model: 'Ranger', engine: null, year_start: 2012, year_end: 2018 },
  ];
  const out = formatApplicationText(apps, { style: 'tableCell', dense: true, cache: false });
  // Hino also makes a Ranger, so dropping "Ford" would be a wrong answer.
  assert.ok(out.includes('Ford'), `make must be kept for an ambiguous model: ${out}`);
  __resetDictionaryForTests();
});

test('dense mode shortens years and compresses engine codes together', () => {
  withDictionary();
  const out = formatApplicationText(PART, { style: 'tableCell', dense: true, includeYears: true, cache: false });
  assert.ok(out.includes('4D55/6'), `engines should compress: ${out}`);
  assert.ok(out.includes('05-15') || out.includes('95-10'), `years should shorten: ${out}`);
  assert.ok(!out.includes('2005-2015'), `full years should be gone: ${out}`);
  __resetDictionaryForTests();
});

test('dense mode applies curated name shorthand', () => {
  withDictionary();
  const apps = [
    { make: 'UD Trucks / Nissan Diesel', model: 'Ranger', engine: null, year_start: 2010, year_end: 2015 },
  ];
  const out = formatApplicationText(apps, { style: 'tableCell', dense: true, cache: false });
  assert.ok(out.includes('UD'), out);
  assert.ok(!out.includes('Nissan Diesel'), `long make name should be shortened: ${out}`);
  __resetDictionaryForTests();
});

test('without the dictionary loaded, no make is ever dropped', () => {
  __resetDictionaryForTests();
  const out = formatApplicationText(PART, { style: 'tableCell', dense: true, cache: false });
  // Degrades to the long-but-correct form rather than a possibly wrong short one.
  assert.ok(out.includes('Toyota') || out.includes('Mitsubishi'), out);
});

test('compression never happens unless asked for', () => {
  withDictionary();
  // No preset, no dense flag, no budget: everything written out in full. The
  // tableCell/searchSuggestion presets DO opt into the adaptive ladder, which is
  // what makes those surfaces compress.
  const out = formatApplicationText(PART, { mergeModelsByMake: true, truncateMode: 'none', cache: false });
  assert.ok(out.includes('Toyota'), `make should remain: ${out}`);
  assert.ok(out.includes('2005-2015'), `years should stay full: ${out}`);
  __resetDictionaryForTests();
});

test('dense output is materially shorter than uncompressed output', () => {
  withDictionary();
  const plain = formatApplicationText(PART, { mergeModelsByMake: true, truncateMode: 'none', cache: false });
  const dense = formatApplicationText(PART, { mergeModelsByMake: true, truncateMode: 'none', dense: true, cache: false });
  assert.ok(dense.length < plain.length, `${dense.length} should be < ${plain.length}`);
  __resetDictionaryForTests();
});

test('the tableCell preset compresses only as far as its budget requires', () => {
  withDictionary();
  const out = formatApplicationText(PART, { style: 'tableCell', cache: false });
  assert.ok(out.length <= 60, `should fit the 60-char budget: ${out.length} - ${out}`);
  // Two fitments still fit with every vehicle named; nothing is hidden.
  assert.ok(out.includes('Hilux') && out.includes('L300'), `both vehicles should show: ${out}`);
  assert.ok(!out.includes('more'), `nothing should be hidden: ${out}`);
  __resetDictionaryForTests();
});

// --- Graduated compression ladder (PRD-FBS-FIT-002 §10d) -------------------
// The priority is to show every fitment for as long as possible; compressions
// are spent cheapest-first, and hiding fitments behind "+N more" is last.

const BIG = [
  { make:'Toyota', model:'Hilux', engine:'1GD-FTV', year_start:2005, year_end:2015 },
  { make:'Toyota', model:'Hilux', engine:'1KD-FTV', year_start:2005, year_end:2015 },
  { make:'Toyota', model:'Fortuner', engine:'2KD-FTV', year_start:2005, year_end:2015 },
  { make:'Toyota', model:'Innova', engine:'2KD-FTV', year_start:2005, year_end:2015 },
  { make:'Mitsubishi', model:'L300', engine:'4D55', year_start:1995, year_end:2010 },
  { make:'Mitsubishi', model:'L300', engine:'4D56', year_start:1995, year_end:2010 },
  { make:'Isuzu', model:'Crosswind', engine:'4JA1', year_start:2001, year_end:2017 },
];

const adaptive = (budget, apps = BIG) => formatApplicationText(apps, {
  mergeModelsByMake: true, adaptive: true, budget, cache: false,
});

test('a generous budget compresses nothing at all', () => {
  withDictionary();
  const out = adaptive(1000);
  assert.ok(out.includes('Toyota'), `make should survive: ${out}`);
  assert.ok(out.includes('2005-2015'), `full years should survive: ${out}`);
  __resetDictionaryForTests();
});

test('the first squeeze is lossless: shorthand and short years, make kept', () => {
  withDictionary();
  const full = adaptive(1000);
  const out = adaptive(full.length - 1);
  assert.ok(out.includes('05-15'), `years should shorten first: ${out}`);
  assert.ok(out.includes('Toyota'), `make should not be dropped yet: ${out}`);
  __resetDictionaryForTests();
});

test('the make is dropped before any engine code is', () => {
  withDictionary();
  const rung1 = adaptive(1000000);
  void rung1;
  // Budget tight enough to force past rung 1 but not past rung 2.
  const lossless = formatApplicationText(BIG, {
    mergeModelsByMake: true, useShorthand: true, shortenYears: true,
    truncateMode: 'none', cache: false,
  });
  const out = adaptive(lossless.length - 1);
  assert.ok(!out.includes('Toyota'), `make should go first: ${out}`);
  assert.ok(out.includes('4D55/6') || out.includes('FTV'), `engines should still be present: ${out}`);
  __resetDictionaryForTests();
});

test('engines are dropped before any fitment is hidden', () => {
  withDictionary();
  const out = adaptive(95);
  assert.ok(!out.includes('+'), `nothing should be hidden yet: ${out}`);
  assert.ok(out.includes('Crosswind'), `every vehicle should still show: ${out}`);
  assert.ok(!out.includes('FTV'), `engines should be gone: ${out}`);
  __resetDictionaryForTests();
});

test('hiding fitments is the last resort, and sheds as few as possible', () => {
  withDictionary();
  const out = adaptive(45);
  assert.ok(out.includes('more'), `should fall back to a count: ${out}`);
  __resetDictionaryForTests();
});

test('an ambiguous model keeps its make even under budget pressure', () => {
  withDictionary();
  const apps = [{ make:'Ford', model:'Ranger', engine:'P4AT', year_start:2012, year_end:2018 }];
  const out = formatApplicationText(apps, {
    mergeModelsByMake: true, adaptive: true, budget: 12, cache: false,
  });
  // Hino also makes a Ranger. Squeezing hard must never produce a bare "Ranger".
  assert.ok(out.includes('Ford'), `make must survive compression: ${out}`);
  __resetDictionaryForTests();
});

test('a short fitment list is never compressed', () => {
  withDictionary();
  const small = [{ make:'Toyota', model:'Hilux', engine:'2KD-FTV', year_start:2005, year_end:2015 }];
  const out = formatApplicationText(small, {
    mergeModelsByMake: true, adaptive: true, budget: 120, cache: false,
  });
  assert.equal(out, 'Toyota Hilux (2KD-FTV) (2005-2015)');
  __resetDictionaryForTests();
});
