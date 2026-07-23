// Mock db module before requiring taxCalculationService
jest.mock('../db', () => ({
    query: jest.fn().mockResolvedValue({
        rows: [{ rate_percentage: '12.00', tax_rate_id: 1 }]
    })
}));

const { calculateInvoiceTax, validateTaxCalculation } = require('../services/taxCalculationService');

describe('Tax Cross-Cutting Calculations Unit Tests', () => {
    describe('calculateInvoiceTax', () => {
        test('should calculate tax-exclusive line items correctly', async () => {
            const mockLines = [
                {
                    part_id: 1,
                    quantity: 2,
                    sale_price: 100,
                    discount_amount: 0
                }
            ];
            const mockParts = [
                {
                    part_id: 1,
                    tax_rate_id: 1,
                    is_tax_inclusive_price: false
                }
            ];

            const result = await calculateInvoiceTax(mockLines, mockParts);

            expect(result.subtotal_ex_tax).toBe(200);
            expect(result.tax_total).toBe(24);
            expect(result.total_amount).toBe(224);
            expect(result.lines[0].tax_base).toBe(200);
            expect(result.lines[0].tax_amount).toBe(24);
        });

        test('should calculate tax-inclusive line items correctly', async () => {
            const mockLines = [
                {
                    part_id: 2,
                    quantity: 1,
                    sale_price: 112,
                    discount_amount: 0
                }
            ];
            const mockParts = [
                {
                    part_id: 2,
                    tax_rate_id: 1,
                    is_tax_inclusive_price: true
                }
            ];

            const result = await calculateInvoiceTax(mockLines, mockParts);

            expect(result.subtotal_ex_tax).toBe(100);
            expect(result.tax_total).toBe(12);
            expect(result.total_amount).toBe(112);
            expect(result.lines[0].tax_base).toBe(100);
            expect(result.lines[0].tax_amount).toBe(12);
        });
    });

    describe('validateTaxCalculation', () => {
        test('should return true for valid tax breakdown matching total', () => {
            const isValid = validateTaxCalculation({
                subtotal_ex_tax: 100,
                tax_total: 12,
                total_amount: 112,
                lines: [{ tax_base: 100, tax_amount: 12 }]
            });
            expect(isValid).toBe(true);
        });

        test('should return false when totals do not balance', () => {
            const isValid = validateTaxCalculation({
                subtotal_ex_tax: 100,
                tax_total: 10,
                total_amount: 112,
                lines: [{ tax_base: 100, tax_amount: 12 }]
            });
            expect(isValid).toBe(false);
        });
    });
});
