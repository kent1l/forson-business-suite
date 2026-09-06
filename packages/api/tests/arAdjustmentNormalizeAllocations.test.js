'use strict';

/**
 * How a concession's allocation list is turned into the document's amount.
 *
 * This is not merely input tidying. The route that authorizes a concession has
 * to compute the amount being approved from the same input the service will
 * write the document from, and for a while it did not: the route summed the raw
 * list while the service silently discarded non-positive entries. A caller
 * could send a large positive line and a nearly equal negative one, have the
 * manager's authorization checked against the near-zero signed sum, and have the
 * full amount written off. These cases exist so that cannot come back.
 */

const { normalizeAllocations, AdjustmentError } = require('../services/arAdjustmentService');

describe('normalizeAllocations', () => {
    it('returns the lines and their total', () => {
        expect(normalizeAllocations([
            { invoice_id: 887, amount: 4200 },
            { invoice_id: 902, amount: '1150.00' },
        ])).toEqual({
            allocations: [{ invoice_id: 887, amount: 4200 }, { invoice_id: 902, amount: 1150 }],
            total: 5350,
        });
    });

    it('rejects a negative line rather than dropping it', () => {
        // The exact shape of the bypass: signed sum 0.01, real document 50,000.
        expect(() => normalizeAllocations([
            { invoice_id: 900, amount: 50000 },
            { invoice_id: 900, amount: -49999.99 },
        ])).toThrow(AdjustmentError);
    });

    it('rejects a zero line', () => {
        expect(() => normalizeAllocations([{ invoice_id: 900, amount: 0 }])).toThrow(/greater than zero/);
    });

    it('rejects a line with no invoice', () => {
        expect(() => normalizeAllocations([{ amount: 100 }])).toThrow(/must name the invoice/);
    });

    it('rejects the same invoice twice', () => {
        expect(() => normalizeAllocations([
            { invoice_id: 900, amount: 100 },
            { invoice_id: 900, amount: 200 },
        ])).toThrow(/listed twice/);
    });

    it('rejects an empty or missing list', () => {
        expect(() => normalizeAllocations([])).toThrow(/must name the invoices/);
        expect(() => normalizeAllocations(undefined)).toThrow(/must name the invoices/);
    });

    it('rounds to centavos, so the authorized and written totals agree exactly', () => {
        const { total } = normalizeAllocations([
            { invoice_id: 1, amount: 0.005 },
            { invoice_id: 2, amount: 10.004 },
        ]);
        expect(total).toBe(10.01);
    });
});
