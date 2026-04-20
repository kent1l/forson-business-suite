const { amountToWords } = require('../helpers/chequeAmountWords');

describe('amountToWords', () => {
    it('formats whole and cent values', () => {
        expect(amountToWords(1250.5)).toBe('one thousand two hundred fifty pesos and 50/100');
    });

    it('handles zero whole amount', () => {
        expect(amountToWords(0.75)).toBe('zero pesos and 75/100');
    });

    it('omits decimal fraction when amount is whole', () => {
        expect(amountToWords(500)).toBe('five hundred pesos');
    });

    it('supports custom suffix', () => {
        expect(amountToWords(12.25, { suffix: 'dollars' })).toBe('twelve dollars and 25/100');
    });

    it('throws for negative numbers', () => {
        expect(() => amountToWords(-1)).toThrow('Amount must be a non-negative number');
    });
});
