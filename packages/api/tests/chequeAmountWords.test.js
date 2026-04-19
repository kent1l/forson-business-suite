const { amountToWords } = require('../helpers/chequeAmountWords');

describe('amountToWords', () => {
    it('formats whole and cent values', () => {
        expect(amountToWords(1250.5)).toBe('one thousand two hundred fifty and 50/100');
    });

    it('handles zero whole amount', () => {
        expect(amountToWords(0.75)).toBe('zero and 75/100');
    });

    it('throws for negative numbers', () => {
        expect(() => amountToWords(-1)).toThrow('Amount must be a non-negative number');
    });
});
