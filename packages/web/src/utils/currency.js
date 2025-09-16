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
export const formatCurrency = (value) => {
    const num = Number(value) || 0;
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};