import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  compressEngineCodes,
  groupFitmentsForDisplay,
  formatFitmentGroup,
  groupApplicationsForDisplay,
  formatApplicationScopeBadge,
  fitmentSavePayload,
} from '../src/utils/engineCodeFormat.js';

// Half of the round-trip guard from PRD-FBS-FIT-002 §9.3. The other half runs in
// the API's jest suite against the same fixture: if compression and expansion
// ever disagree, one of the two suites goes red.
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '..', '..', 'api', 'tests', 'fixtures', 'engineCodeRoundTrip.json'), 'utf8'),
);

test('compresses each round-trip fixture case to its shorthand', () => {
  for (const { codes, compressed } of fixtures.roundTrip) {
    assert.equal(compressEngineCodes(codes), compressed, `codes ${codes.join(',')}`);
  }
});

test('refuses to compress anything the safety rules exclude', () => {
  for (const { codes, why } of fixtures.notCompressible) {
    assert.equal(compressEngineCodes(codes), null, `${codes.join(',')} - ${why}`);
  }
});

test('compression is order-independent', () => {
  assert.equal(compressEngineCodes(['4D56', '4D55']), '4D55/6');
});

test('duplicate codes collapse before grouping', () => {
  assert.equal(compressEngineCodes(['4D55', '4D55']), null);
  assert.equal(compressEngineCodes(['4D55', '4D56', '4D55']), '4D55/6');
});

test('handles empty and malformed input without throwing', () => {
  assert.equal(compressEngineCodes([]), null);
  assert.equal(compressEngineCodes(null), null);
  assert.equal(compressEngineCodes([null, '', '  ']), null);
});

test('only groups engines within an identical vehicle context', () => {
  // The dangerous case: without context grouping these would merge into a
  // single line asserting a fitment nobody entered.
  const groups = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2005, year_end: 2010 },
    { make: 'Mitsubishi', model: 'L300', engine: '4D55', year_start: 1995, year_end: 2000 },
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(g => g.compressed === false));
});

test('compresses engines that share make, model and year range', () => {
  const groups = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D55', year_start: 2005, year_end: 2015 },
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2005, year_end: 2015 },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].engineDisplay, '4D55/6');
  assert.equal(groups[0].compressed, true);
});

test('does not compress across differing year ranges on the same model', () => {
  const groups = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D55', year_start: 2005, year_end: 2010 },
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2011, year_end: 2015 },
  ]);
  assert.equal(groups.length, 2);
});

test('never loses the underlying codes when compressing', () => {
  const [group] = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D55', year_start: null, year_end: null },
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: null, year_end: null },
  ]);
  assert.deepEqual(group.engineCodes, ['4D55', '4D56']);
  assert.equal(group.fitments.length, 2);
});

test('formats a group into a readable line', () => {
  const [group] = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D55', year_start: 2005, year_end: 2015 },
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2005, year_end: 2015 },
  ]);
  assert.equal(formatFitmentGroup(group), 'Toyota Hilux 4D55/6 (2005-2015)');
});

test('formats single-year and open-ended ranges', () => {
  const [single] = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2015, year_end: 2015 },
  ]);
  assert.equal(formatFitmentGroup(single), 'Toyota Hilux 4D56 (2015)');

  const [open] = groupFitmentsForDisplay([
    { make: 'Toyota', model: 'Hilux', engine: '4D56', year_start: 2015, year_end: null },
  ]);
  assert.equal(formatFitmentGroup(open), 'Toyota Hilux 4D56 (2015+)');
});

test('keeps exclusions, qualifiers and evidence separate when grouping fitments', () => {
  const base = { make: 'Toyota', model: 'Hilux', engine: '1KD-FTV', year_start: 2005, year_end: 2015 };
  const rows = [
    base,
    { ...base, effect: 'exclude' },
    { ...base, chassis: 'KUN26' },
    { ...base, position: 'Front' },
    { ...base, approval_status: 'approved' },
    { ...base, evidence_status: 'sourced_suggestion' },
    { ...base, engine: null, engine_mode: 'unrestricted' },
  ];
  const groups = groupFitmentsForDisplay(rows);
  assert.equal(groups.length, rows.length);
  assert.equal(groups[1].effect, 'exclude');
  assert.match(formatFitmentGroup(groups[2]), /\[KUN26\]/);
  assert.ok(groups.every(group => group.fitments.length === 1));
});

test('display never unions disjoint years or qualifier scope modes', () => {
  const base = { make: 'Toyota', model: 'Hilux', engine: '1KD-FTV', year_start: 2005, year_end: 2010 };
  const rows = [base, { ...base, year_start: 2015, year_end: 2020 }, { ...base, market_mode: 'unrestricted' }, { ...base, generation: 'Gen 2' }];
  assert.equal(groupApplicationsForDisplay(rows).length, 4);
  assert.equal(groupFitmentsForDisplay(rows).length, 4);
});

test('verification badge requires both compatibility approval and sourced verification', () => {
  assert.notEqual(formatApplicationScopeBadge({ approval_status: 'approved', evidence_status: 'user_declared' }).label, 'Verified');
  assert.notEqual(formatApplicationScopeBadge({ approval_status: 'needs_review', evidence_status: 'sourced_verified' }).label, 'Verified');
  assert.equal(formatApplicationScopeBadge({ approval_status: 'approved', evidence_status: 'sourced_verified' }).label, 'Verified');
});

test('save payload preserves restrictions and review tokens without sending response approval fields', () => {
  const payload = fitmentSavePayload({ application_id: 1, candidate_id: 5, effect: 'exclude', position: 'Front', transmission: 'Manual', generation: 'Gen 2', year_start: '', approval_status: 'approved', evidence_status: 'sourced_verified' }, 3, 7);
  assert.deepEqual(payload, { application_id: 1, effect: 'exclude', position: 'Front', transmission: 'Manual', generation: 'Gen 2', year_start: null, review_id: 3, candidate_id: 5, expected_version: 7 });
});
