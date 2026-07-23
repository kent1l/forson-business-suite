import { 
    parsePaymentTermsDays, 
    formatPaymentTerms, 
    computeDueDate, 
    calculateDaysOverdue, 
    formatDueDate 
} from '../src/utils/terms.js';
import { describe, it, expect } from 'vitest';

describe('Frontend payment terms utilities', () => {
    it('parsePaymentTermsDays works correctly', () => {
        // Existing tests
        expect(parsePaymentTermsDays('Net 30')).toBe(30);
        expect(parsePaymentTermsDays('30 days')).toBe(30);
        expect(parsePaymentTermsDays('Due upon receipt')).toBe(0);
        expect(parsePaymentTermsDays('Due on receipt')).toBe(0);
        expect(parsePaymentTermsDays('Custom 45')).toBe(45);
        expect(parsePaymentTermsDays('')).toBe(null);

        // Enhanced tests
        expect(parsePaymentTermsDays(30)).toBe(30);
        expect(parsePaymentTermsDays(0)).toBe(0);
        expect(parsePaymentTermsDays(-1)).toBe(null);
        expect(parsePaymentTermsDays(10000)).toBe(null);
        expect(parsePaymentTermsDays('Cash')).toBe(0);
        expect(parsePaymentTermsDays('COD')).toBe(0);
        expect(parsePaymentTermsDays('immediate')).toBe(0);
    });

    it('formatPaymentTerms works correctly', () => {
        expect(formatPaymentTerms(0)).toBe('Due on receipt');
        expect(formatPaymentTerms(30)).toBe('30 days');
        expect(formatPaymentTerms('Net 30')).toBe('Net 30');
        expect(formatPaymentTerms(null)).toBe('No terms specified');
    });

    it('computeDueDate works correctly', () => {
        const testDate = new Date('2025-09-16T12:00:00Z');
        const expectedDue30 = new Date('2025-10-16T12:00:00Z');
        const expectedDue0 = new Date('2025-09-16T12:00:00Z');

        expect(computeDueDate(30, testDate)).toStrictEqual(expectedDue30);
        expect(computeDueDate(0, testDate)).toStrictEqual(expectedDue0);
        expect(computeDueDate(-1, testDate)).toBe(null);
        expect(computeDueDate(1.5, testDate)).toBe(null);
    });

    it('calculateDaysOverdue works correctly', () => {
        const currentDate = new Date('2025-09-16T12:00:00Z');
        const pastDue = new Date('2025-09-06T12:00:00Z'); // 10 days ago
        const futureDue = new Date('2025-09-26T12:00:00Z'); // 10 days from now

        expect(calculateDaysOverdue(pastDue, currentDate)).toBe(10);
        expect(calculateDaysOverdue(futureDue, currentDate)).toBe(-10);
        expect(calculateDaysOverdue(currentDate, currentDate)).toBe(0);
        expect(calculateDaysOverdue(null, currentDate)).toBe(0);
    });

    it('formatDueDate works correctly', () => {
        const testDueDate = new Date('2025-09-16T12:00:00Z');
        const formatted = formatDueDate(testDueDate, { showOverdue: false });
        expect(formatted).toContain('Sep');
        expect(formatted).toContain('16');
        expect(formatted).toContain('2025');

        expect(formatDueDate(null)).toBe('No due date');
        expect(formatDueDate('invalid')).toBe('Invalid date');
    });
});
