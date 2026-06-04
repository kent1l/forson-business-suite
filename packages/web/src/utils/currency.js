/**
 * Currency Utility Functions
 *
 * Provides standardized currency formatting for the Forson Business Suite application.
 * Handles Philippine Peso (₱) formatting with proper locale settings and decimal precision.
 *
 * Features:
 * - Consistent currency display across the application
 * - Philippine locale formatting (en-PH)
 * - Fixed 2 decimal places for monetary values
 * - Handles null/undefined values gracefully
 *
 * Used throughout: Invoice displays, payment forms, reports, and financial summaries
 */

// Utility functions for currency formatting
export const formatCurrency = (value, currencySymbol = '₱') => {
    const num = Number(value) || 0;
    const sign = num < 0 ? '-' : '';
    const absValue = Math.abs(num);
    return `${sign}${currencySymbol}${absValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
