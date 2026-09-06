const {
    costedLineCondition,
    costedPartCondition,
    buildCostCoverage,
    COVERAGE_LEVELS,
} = require('../helpers/costCoverage');

describe('costCoverage helper', () => {
    describe('costedLineCondition', () => {
        test('excludes both NULL and zero costs', () => {
            const sql = costedLineCondition('il');
            expect(sql).toContain('il.cost_at_sale IS NOT NULL');
            expect(sql).toContain('il.cost_at_sale > 0');
        });

        test('is parenthesised so it can be ANDed into an existing WHERE clause', () => {
            expect(costedLineCondition('il').startsWith('(')).toBe(true);
            expect(costedLineCondition('il').endsWith(')')).toBe(true);
        });

        test('honours the alias it is given', () => {
            expect(costedLineCondition('line')).toContain('line.cost_at_sale');
        });
    });

    describe('costedPartCondition', () => {
        test('excludes parts with no usable weighted average cost', () => {
            const sql = costedPartCondition('p');
            expect(sql).toContain('p.wac_cost IS NOT NULL');
            expect(sql).toContain('p.wac_cost > 0');
        });
    });

    describe('buildCostCoverage', () => {
        test('reports the revenue-weighted ratio as the headline', () => {
            const c = buildCostCoverage({
                costedRevenue: 2500, totalRevenue: 10000, costedLines: 5, totalLines: 100,
            });
            expect(c.valueRatio).toBeCloseTo(0.25);
            expect(c.rowRatio).toBeCloseTo(0.05);
        });

        test('grades coverage into levels', () => {
            const level = (num, den) =>
                buildCostCoverage({ costedRevenue: num, totalRevenue: den }).level;

            expect(level(95, 100)).toBe(COVERAGE_LEVELS.OK);
            expect(level(90, 100)).toBe(COVERAGE_LEVELS.OK);
            expect(level(70, 100)).toBe(COVERAGE_LEVELS.PARTIAL);
            expect(level(50, 100)).toBe(COVERAGE_LEVELS.PARTIAL);
            expect(level(20, 100)).toBe(COVERAGE_LEVELS.LOW);
            expect(level(0, 100)).toBe(COVERAGE_LEVELS.NONE);
        });

        test('reports "none" rather than dividing by zero when there is no revenue', () => {
            const c = buildCostCoverage({ costedRevenue: 0, totalRevenue: 0 });
            expect(c.valueRatio).toBe(0);
            expect(c.rowRatio).toBe(0);
            expect(c.level).toBe(COVERAGE_LEVELS.NONE);
        });

        test('coerces the numeric strings node-postgres returns', () => {
            const c = buildCostCoverage({
                costedRevenue: '2500.00', totalRevenue: '10000.00', costedLines: '5', totalLines: '100',
            });
            expect(c.costedRevenue).toBe(2500);
            expect(c.totalRevenue).toBe(10000);
            expect(c.valueRatio).toBeCloseTo(0.25);
        });

        test('carries an explanation so callers never have to invent the wording', () => {
            const c = buildCostCoverage({ costedRevenue: 1, totalRevenue: 2 });
            expect(typeof c.explanation).toBe('string');
            expect(c.explanation.length).toBeGreaterThan(0);
        });

        test('matches the live shape of this database: ~20% coverage reads as low', () => {
            // Measured 2026-09: 9,566 of 11,535 lines carry cost 0.
            const c = buildCostCoverage({
                costedRevenue: 2297769, totalRevenue: 11684240,
                costedLines: 1969, totalLines: 11535,
            });
            expect(c.level).toBe(COVERAGE_LEVELS.LOW);
            expect(c.valueRatio).toBeGreaterThan(0.19);
            expect(c.valueRatio).toBeLessThan(0.21);
        });
    });
});
