// Utility functions for currency formatting
export const formatCurrency = (value) => {
    const num = Number(value) || 0;
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};