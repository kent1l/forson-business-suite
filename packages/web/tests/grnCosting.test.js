import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeCosting, distributeByWeight, markupFromPrice, priceFromMarkup } from '../src/utils/grnCosting.js';

// The same truth table the API's jest suite runs, against the generated web copy of the
// module. If the two ever compute differently, one of these two suites goes red.
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '..', '..', 'api', 'tests', 'fixtures', 'grnCostingCases.json'), 'utf8'),
);

for (const testCase of fixtures.cases) {
  test(`grnCosting: ${testCase.name}`, () => {
    const result = computeCosting(testCase.input);

    if (testCase.expectError) {
      assert.ok(
        result.errors.some((e) => e.code === testCase.expectError),
        `expected error ${testCase.expectError}, got ${JSON.stringify(result.errors)}`,
      );
      return;
    }
    assert.deepEqual(result.errors, []);

    if (testCase.expectWarning) {
      assert.ok(
        result.warnings.some((w) => w.code === testCase.expectWarning),
        `expected warning ${testCase.expectWarning}`,
      );
    }
    if (!testCase.expect) return;

    for (const [key, expected] of Object.entries(testCase.expect)) {
      if (key === 'totals') {
        for (const [totalKey, value] of Object.entries(expected)) {
          assert.ok(
            Math.abs(result.totals[totalKey] - value) < 0.005,
            `${totalKey}: got ${result.totals[totalKey]}, want ${value}`,
          );
        }
      } else {
        assert.deepEqual(result.lines.map((l) => l[key]), expected, key);
      }
    }
  });
}

test('grnCosting: freight allocation always sums to the freight charged', () => {
  // Rounding that loses a cent would mean inventory is capitalised at a different
  // figure than the carrier billed, which is the one thing this must never do.
  for (const freight of [0.01, 7, 99.99, 1000, 1234.56]) {
    for (let lineCount = 1; lineCount <= 9; lineCount += 1) {
      const lines = Array.from({ length: lineCount }, (_, i) => ({
        quantity: i + 1,
        cost_price: 13.37 * (i + 1),
      }));
      const { totals } = computeCosting({ lines, freightAmount: freight });
      assert.equal(totals.freight_allocated, freight, `${lineCount} lines, freight ${freight}`);
    }
  }
});

test('grnCosting: distributeByWeight never invents or loses money', () => {
  assert.deepEqual(distributeByWeight(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
  assert.deepEqual(distributeByWeight(10, [0, 0]), [5, 5]);
  assert.deepEqual(distributeByWeight(0, [1, 2]), [0, 0]);
  assert.deepEqual(distributeByWeight(5, []), []);
});

test('grnCosting: markup and price are inverses', () => {
  const price = priceFromMarkup(250, 70);
  assert.equal(price, 425);
  assert.equal(markupFromPrice(425, 250), 70);
  assert.equal(markupFromPrice(100, 0), null);
});
