const fixtures = require('./fixtures/grnCostingCases.json');
const {
  computeCosting,
  distributeByWeight,
  priceFromMarkup,
  markupFromPrice,
  DEFAULT_MARKUP_PERCENT,
  MIN_MARKUP_PERCENT,
} = require('../services/grnCostingService');

// The shared truth table. packages/web/tests/grnCosting.test.js runs the same file
// against the web mirror of this module, so an implementation that drifts on either
// side fails here or there.
describe('grnCostingService — shared fixture cases', () => {
  fixtures.cases.forEach((testCase) => {
    test(testCase.name, () => {
      const result = computeCosting(testCase.input);

      if (testCase.expectError) {
        expect(result.errors.map((e) => e.code)).toContain(testCase.expectError);
        return;
      }
      expect(result.errors).toEqual([]);

      if (testCase.expectWarning) {
        expect(result.warnings.map((w) => w.code)).toContain(testCase.expectWarning);
      }
      if (!testCase.expect) return;

      Object.entries(testCase.expect).forEach(([key, expected]) => {
        if (key === 'totals') {
          Object.entries(expected).forEach(([totalKey, value]) => {
            expect(result.totals[totalKey]).toBeCloseTo(value, 2);
          });
        } else {
          expect(result.lines.map((line) => line[key])).toEqual(expected);
        }
      });
    });
  });
});

describe('distributeByWeight', () => {
  test('assigns every cent, never inventing or losing one', () => {
    const parts = distributeByWeight(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  test('splits evenly when there is no basis to weigh on', () => {
    expect(distributeByWeight(10, [0, 0, 0, 0])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  test('gives a zero total nothing to distribute', () => {
    expect(distributeByWeight(0, [5, 3])).toEqual([0, 0]);
  });

  test('handles an empty document', () => {
    expect(distributeByWeight(500, [])).toEqual([]);
  });

  test('sends nothing to a zero-weight line when others carry weight', () => {
    expect(distributeByWeight(90, [0, 2, 1])).toEqual([0, 60, 30]);
  });

  test('stays exact across many awkward splits', () => {
    for (let n = 2; n <= 25; n += 1) {
      const weights = Array.from({ length: n }, (_, i) => i + 1);
      const parts = distributeByWeight(1234.56, weights);
      const sum = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
      expect(sum).toBe(1234.56);
    }
  });
});

describe('markup arithmetic', () => {
  test('the default markup is 70% and the floor is 30%', () => {
    expect(DEFAULT_MARKUP_PERCENT).toBe(70);
    expect(MIN_MARKUP_PERCENT).toBe(30);
  });

  test('price and markup are inverses of each other', () => {
    const price = priceFromMarkup(123.45, 70);
    expect(price).toBe(209.87);
    expect(markupFromPrice(price, 123.45)).toBeCloseTo(70, 1);
  });

  test('markup is undefined when landed cost is zero, not Infinity', () => {
    expect(markupFromPrice(100, 0)).toBeNull();
  });
});

describe('edge cases the ledger cares about', () => {
  test('a fully returned line contributes no cost and no crash', () => {
    const result = computeCosting({
      lines: [
        { quantity: 5, cost_price: 100, return_quantity: 5 },
        { quantity: 5, cost_price: 100 },
      ],
      freightAmount: 200,
    });
    expect(result.lines[0].accepted_quantity).toBe(0);
    expect(result.lines[0].landed_unit_cost).toBe(0);
    // The whole shipment's freight lands on what actually stayed.
    expect(result.lines[1].allocated_freight_amount).toBe(200);
    expect(result.totals.net_goods_value).toBe(500);
  });

  test('an empty document computes to zeroes rather than NaN', () => {
    const result = computeCosting({ lines: [], freightAmount: 100 });
    expect(result.totals.net_goods_value).toBe(0);
    expect(result.totals.freight_allocated).toBe(0);
  });

  test('a discount larger than the line it sits on is rejected', () => {
    const result = computeCosting({
      lines: [{ quantity: 1, cost_price: 100, line_discount_amount: 500 }],
    });
    expect(result.errors.map((e) => e.code)).toContain('LINE_DISCOUNT_EXCEEDS_VALUE');
  });

  test('a header discount larger than the receipt is rejected', () => {
    const result = computeCosting({
      lines: [{ quantity: 1, cost_price: 100 }],
      overallDiscountAmount: 5000,
    });
    expect(result.errors.map((e) => e.code)).toContain('HEADER_DISCOUNT_EXCEEDS_VALUE');
  });

  test('the supplier control total is measured as delivered, before returns', () => {
    // This is the figure an encoder checks against the paper in their hand, so it must
    // not move when goods are sent back.
    const withoutReturn = computeCosting({ lines: [{ quantity: 10, cost_price: 100 }] });
    const withReturn = computeCosting({ lines: [{ quantity: 10, cost_price: 100, return_quantity: 4 }] });
    expect(withReturn.totals.supplier_invoice_total).toBe(withoutReturn.totals.supplier_invoice_total);
    expect(withReturn.totals.returned_value).toBe(400);
    expect(withReturn.totals.net_goods_value).toBe(600);
  });

  test('freight is capitalised into cost, never discounted away by the header', () => {
    const result = computeCosting({
      lines: [{ quantity: 1, cost_price: 1000 }],
      freightAmount: 100,
      overallDiscountPercent: 50,
    });
    // Half off the supplier's 1000, plus the carrier's full 100.
    expect(result.lines[0].landed_unit_cost).toBe(600);
    expect(result.totals.total_inventory_value).toBe(600);
  });

  test('a negative return quantity cannot be used to inflate a receipt', () => {
    const result = computeCosting({ lines: [{ quantity: 5, cost_price: 100, return_quantity: -3 }] });
    expect(result.lines[0].accepted_quantity).toBe(5);
  });

  test('a return larger than the line is clamped to the line', () => {
    const result = computeCosting({ lines: [{ quantity: 5, cost_price: 100, return_quantity: 99 }] });
    expect(result.lines[0].return_quantity).toBe(5);
    expect(result.lines[0].accepted_quantity).toBe(0);
  });
});
