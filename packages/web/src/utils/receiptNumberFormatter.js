/**
 * Frontend utility for formatting and normalizing physical receipt numbers
 * Mirrors backend logic for consistency across the application
 * Used by React components and client-side processing
 * @param {string|null|undefined} receiptNumber - The receipt number to format
 * @returns {string|null} - Formatted receipt number or null if empty
 */
const formatPhysicalReceiptNumber = (receiptNumber) => {
    // Handle null, undefined, or non-string inputs
    if (receiptNumber === null || receiptNumber === undefined) {
        return null;
    }

    // Ensure it's a string and trim whitespace
    const trimmed = String(receiptNumber).trim();

    // Return null for empty strings
    if (trimmed.length === 0) {
        return null;
    }

    // Advanced formatting: convert to uppercase and normalize format
    let formatted = trimmed.toUpperCase();

    // Extract leading letters and trailing digits with proper formatting
    // Accept inputs like 'SI 1234', 'si-1234', 'SI/1234', 'SI1234' -> normalize to 'SI-1234'
    const match = formatted.match(/^([A-Z]{1,3})\W*0*([0-9]{1,})$/i);
    if (match) {
        const letters = match[1];
        const digits = match[2];
        return `${letters}-${digits}`;
    }

    // Fallback: replace any sequences of non-alphanum with a single dash
    formatted = formatted.replace(/[^A-Z0-9]+/g, '-');

    return formatted;
};

export { formatPhysicalReceiptNumber };
