/**
 * CSV Export Utility Functions
 *
 * Provides functionality for exporting data to CSV format in the Forson Business Suite.
 * Handles data serialization, CSV escaping, and browser download initiation.
 *
 * Features:
 * - Automatic CSV escaping for commas and quotes
 * - Error handling for empty datasets
 * - User feedback via toast notifications
 * - Browser-compatible file download
 * - UTF-8 encoding support
 *
 * Used in: Reports, customer lists, invoice exports, and data backup features
 */

// Utility for CSV export functionality
import toast from 'react-hot-toast';

export const exportToCSV = (data, filename) => {
    if (!data || data.length === 0) {
        toast.error('No data to export');
        return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row =>
            headers.map(header => {
                const value = row[header];
                // Escape commas and quotes in CSV
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
};