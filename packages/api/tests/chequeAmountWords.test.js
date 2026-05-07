const { amountToWords } = require('../helpers/chequeAmountWords');

describe('amountToWords', () => {
    it('formats decimal values using default suffix', () => {
        expect(amountToWords(1250.5)).toBe('one thousand two hundred fifty pesos and 50/100');
    });

    it('omits fraction for whole numbers', () => {
        expect(amountToWords(500)).toBe('five hundred pesos only');
    });

    it('supports custom suffix values', () => {
        expect(amountToWords(77.25, { suffix: 'dollars' })).toBe('seventy seven dollars and 25/100');
    });

    it('handles zero whole amount with decimal', () => {
        expect(amountToWords(0.75)).toBe('zero pesos and 75/100');
    });

    it('throws for negative numbers', () => {
        expect(() => amountToWords(-1)).toThrow('Amount must be a non-negative number');
    });
});
