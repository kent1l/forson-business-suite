// Payment Terms Validation and Parsing Utilities
// Ensures consistent payment terms handling across the backend

/**
 * Parse payment terms into numeric days
 * @param {string|number} terms - Payment terms string or number
 * @returns {number|null} - Number of days or null if invalid
 */
function parsePaymentTermsDays(terms) {
    // Handle explicit numeric input
    if (typeof terms === 'number') {
        return Number.isInteger(terms) && terms >= 0 && terms <= 9999 ? terms : null;
    }
    
    // Handle string input
    if (!terms || typeof terms !== 'string') {
        return null;
    }
    
    const trimmed = terms.trim();
    if (!trimmed) return null;
    
    // Extract numeric value (1-4 digits)
    const match = trimmed.match(/(\d{1,4})/);
    if (match) {
        const days = parseInt(match[1], 10);
        // Validate reasonable range (0-9999 days)
        return days >= 0 && days <= 9999 ? days : null;
    }
    
    // Handle common phrases for immediate payment
    if (/due|upon|receipt|immediate|cash|cod/i.test(trimmed)) {
        return 0;
    }
    
    return null;
}

/**
 * Compute due date from payment terms days
 * @param {number} paymentTermsDays - Number of days from invoice date
 * @param {Date} invoiceDate - Invoice date (defaults to now)
 * @returns {Date|null} - Due date or null if invalid input
 */
function computeDueDate(paymentTermsDays, invoiceDate = new Date()) {
    if (typeof paymentTermsDays !== 'number' || !Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) {
        return null;
    }
    
    if (!(invoiceDate instanceof Date) || isNaN(invoiceDate.getTime())) {
        return null;
    }
    
    const dueDate = new Date(invoiceDate.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
    return dueDate;
}

/**
 * Validate payment terms input for API endpoints
 * @param {object} input - Input object with terms and/or payment_terms_days
 * @returns {object} - Validation result with canonicalDays and dueDate
 */
function validatePaymentTerms(input) {
    const { terms, payment_terms_days, invoice_date } = input;
    const errors = [];
    
    let canonicalDays = null;
    let dueDate = null;
    
    // Priority: explicit payment_terms_days > parsed from terms
    if (typeof payment_terms_days !== 'undefined') {
        canonicalDays = parsePaymentTermsDays(payment_terms_days);
        if (canonicalDays === null && payment_terms_days !== null) {
            errors.push('payment_terms_days must be a valid integer between 0 and 9999');
        }
    }
    
    // Fallback to parsing terms if no explicit days provided
    if (canonicalDays === null && terms) {
        canonicalDays = parsePaymentTermsDays(terms);
        if (canonicalDays === null) {
            errors.push(`Unable to parse payment terms: "${terms}". Use explicit payment_terms_days or standard formats like "Net 30", "Due on receipt"`);
        }
    }
    
    // Compute due date if we have valid days
    if (canonicalDays !== null) {
        const invoiceDateObj = invoice_date ? new Date(invoice_date) : new Date();
        dueDate = computeDueDate(canonicalDays, invoiceDateObj);
        if (!dueDate) {
            errors.push('Invalid invoice_date provided for due date calculation');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        canonicalDays,
        dueDate: dueDate ? dueDate.toISOString() : null,
        normalizedTerms: canonicalDays !== null ? (canonicalDays === 0 ? 'Due on receipt' : `${canonicalDays} days`) : terms || null
    };
}

/**
 * Format payment terms for display
 * @param {number|string} paymentTermsDays - Payment terms in days
 * @returns {string} - Human readable payment terms
 */
function formatPaymentTerms(paymentTermsDays) {
    if (typeof paymentTermsDays === 'number') {
        return paymentTermsDays === 0 ? 'Due on receipt' : `${paymentTermsDays} days`;
    }
    return paymentTermsDays || 'No terms specified';
}

/**
 * Calculate days overdue
 * @param {string|Date} dueDate - Due date
 * @param {string|Date} currentDate - Current date (defaults to now)
 * @returns {number} - Days overdue (negative means not yet due)
 */
function calculateDaysOverdue(dueDate, currentDate = new Date()) {
    if (!dueDate) return 0;
    
    const due = new Date(dueDate);
    const current = new Date(currentDate);
    
    if (isNaN(due.getTime()) || isNaN(current.getTime())) {
        return 0;
    }
    
    const diffMs = current.getTime() - due.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    
    return diffDays;
}

module.exports = {
    parsePaymentTermsDays,
    computeDueDate,
    validatePaymentTerms,
    formatPaymentTerms,
    calculateDaysOverdue
};