const { calculateInvoiceTax, calculateLineTax, validateTaxCalculation } = require('../services/taxCalculationService');

// Mock database module
jest.mock('../db', () => ({
    query: jest.fn()
}));

const db = require('../db');

describe('Tax Calculation Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('calculateLineTax', () => {
        const taxRates = new Map([[1, 0.12], [2, 0.06]]);
        const defaultTaxRate = 0.12;

        test('should calculate tax for tax-exclusive item', () => {
            const line = { quantity: 2, sale_price: 100, discount_amount: 0 };
            const part = { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false };
            
            const result = calculateLineTax(line, part, taxRates, defaultTaxRate);
            
            expect(result.tax_base).toBe(200);
            expect(result.tax_amount).toBe(24); // 200 * 0.12
            expect(result.is_tax_inclusive).toBe(false);
            expect(result.tax_rate_snapshot).toBe(0.12);
        });

        test('should calculate tax for tax-inclusive item', () => {
            const line = { quantity: 1, sale_price: 112, discount_amount: 0 };
            const part = { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: true };
            
            const result = calculateLineTax(line, part, taxRates, defaultTaxRate);
            
            expect(result.tax_base).toBe(100); // 112 / 1.12
            expect(result.tax_amount).toBe(12); // 112 - 100
            expect(result.is_tax_inclusive).toBe(true);
        });

        test('should handle discount amounts', () => {
            const line = { quantity: 1, sale_price: 100, discount_amount: 10 };
            const part = { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false };
            
            const result = calculateLineTax(line, part, taxRates, defaultTaxRate);
            
            expect(result.tax_base).toBe(90); // 100 - 10
            expect(result.tax_amount).toBe(10.8); // 90 * 0.12
        });

        test('should use default tax rate when part has no tax_rate_id', () => {
            const line = { quantity: 1, sale_price: 100, discount_amount: 0 };
            const part = { part_id: 1, tax_rate_id: null, is_tax_inclusive_price: false };
            
            const result = calculateLineTax(line, part, taxRates, defaultTaxRate);
            
            expect(result.tax_rate_snapshot).toBe(0.12);
            expect(result.tax_amount).toBe(12);
        });

        test('should round tax amount to 2 decimal places', () => {
            const line = { quantity: 1, sale_price: 10.33, discount_amount: 0 };
            const part = { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false };
            
            const result = calculateLineTax(line, part, taxRates, defaultTaxRate);
            
            expect(result.tax_amount).toBe(1.24); // 10.33 * 0.12 = 1.2396, rounded to 1.24
        });
    });

    describe('calculateInvoiceTax', () => {
        beforeEach(() => {
            // Mock database responses
            db.query
                .mockResolvedValueOnce({ rows: [{ rate_percentage: 0.12 }] }) // default tax rate
                .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_percentage: 0.12 }] }) // all tax rates
                .mockResolvedValueOnce({ rows: [{ tax_rate_id: 1, rate_name: 'VAT' }] }); // rate names
        });

        test('should calculate tax for multiple lines', async () => {
            const lines = [
                { part_id: 1, quantity: 2, sale_price: 100, discount_amount: 0 },
                { part_id: 2, quantity: 1, sale_price: 50, discount_amount: 5 }
            ];
            const parts = [
                { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false },
                { part_id: 2, tax_rate_id: 1, is_tax_inclusive_price: false }
            ];

            const result = await calculateInvoiceTax(lines, parts);

            expect(result.subtotal_ex_tax).toBe(245); // (2*100) + (50-5)
            expect(result.tax_total).toBe(29.4); // 245 * 0.12
            expect(result.total_amount).toBe(274.4);
            expect(result.lines).toHaveLength(2);
            expect(result.tax_breakdown).toHaveLength(1);
        });

        test('should group tax breakdown by rate', async () => {
            const lines = [
                { part_id: 1, quantity: 1, sale_price: 100, discount_amount: 0 },
                { part_id: 2, quantity: 1, sale_price: 100, discount_amount: 0 }
            ];
            const parts = [
                { part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false },
                { part_id: 2, tax_rate_id: 1, is_tax_inclusive_price: false }
            ];

            const result = await calculateInvoiceTax(lines, parts);

            expect(result.tax_breakdown).toHaveLength(1);
            expect(result.tax_breakdown[0]).toMatchObject({
                tax_rate_id: 1,
                rate_percentage: 0.12,
                tax_base: 200,
                tax_amount: 24,
                line_count: 2
            });
        });
    });

    describe('validateTaxCalculation', () => {
        test('should validate correct calculation', () => {
            const calculation = {
                lines: [
                    { tax_base: 100, tax_amount: 12 },
                    { tax_base: 50, tax_amount: 6 }
                ],
                subtotal_ex_tax: 150,
                tax_total: 18,
                total_amount: 168
            };

            expect(validateTaxCalculation(calculation)).toBe(true);
        });

        test('should reject calculation with incorrect totals', () => {
            const calculation = {
                lines: [
                    { tax_base: 100, tax_amount: 12 },
                    { tax_base: 50, tax_amount: 6 }
                ],
                subtotal_ex_tax: 140, // Wrong total
                tax_total: 18,
                total_amount: 168
            };

            expect(validateTaxCalculation(calculation)).toBe(false);
        });

        test('should allow small rounding differences', () => {
            const calculation = {
                lines: [
                    { tax_base: 100.005, tax_amount: 12.001 }
                ],
                subtotal_ex_tax: 100.01, // Small rounding difference
                tax_total: 12.00,
                total_amount: 112.01
            };

            expect(validateTaxCalculation(calculation)).toBe(true);
        });
    });
});

// Integration test for database interactions
describe('Tax Calculation Integration', () => {
    test('should handle database errors gracefully', async () => {
        db.query.mockRejectedValue(new Error('Database connection failed'));

        const lines = [{ part_id: 1, quantity: 1, sale_price: 100 }];
        const parts = [{ part_id: 1, tax_rate_id: 1, is_tax_inclusive_price: false }];

        await expect(calculateInvoiceTax(lines, parts)).rejects.toThrow('Tax calculation failed');
    });
});