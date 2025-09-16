/**
 * Parse payment terms into numeric days - enhanced version matching backend
 * @param {string|number} terms - Payment terms string or number
 * @returns {number|null} - Number of days or null if invalid
 */
export function parsePaymentTermsDays(terms) {
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
 * Format payment terms for display
 * @param {number|string} paymentTermsDays - Payment terms in days
 * @returns {string} - Human readable payment terms
 */
export function formatPaymentTerms(paymentTermsDays) {
    if (typeof paymentTermsDays === 'number') {
        return paymentTermsDays === 0 ? 'Due on receipt' : `${paymentTermsDays} days`;
    }
    return paymentTermsDays || 'No terms specified';
}

/**
 * Calculate due date from payment terms days
 * @param {number} paymentTermsDays - Number of days from invoice date
 * @param {Date} invoiceDate - Invoice date (defaults to now)
 * @returns {Date|null} - Due date or null if invalid input
 */
export function computeDueDate(paymentTermsDays, invoiceDate = new Date()) {
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
 * Calculate days overdue
 * @param {string|Date} dueDate - Due date
 * @param {string|Date} currentDate - Current date (defaults to now)
 * @returns {number} - Days overdue (negative means not yet due)
 */
export function calculateDaysOverdue(dueDate, currentDate = new Date()) {
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

/**
 * Format due date for display with overdue indication
 * @param {string|Date} dueDate - Due date
 * @param {object} options - Formatting options
 * @returns {string} - Formatted due date string
 */
export function formatDueDate(dueDate, options = {}) {
    const { showOverdue = true, locale = 'en-US' } = options;
    
    if (!dueDate) return 'No due date';
    
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) return 'Invalid date';
    
    const formatted = due.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    
    if (showOverdue) {
        const daysOverdue = calculateDaysOverdue(dueDate);
        if (daysOverdue > 0) {
            return `${formatted} (${daysOverdue} days overdue)`;
        } else if (daysOverdue < 0) {
            return `${formatted} (${Math.abs(daysOverdue)} days remaining)`;
        }
    }
    
    return formatted;
}

export default { 
    parsePaymentTermsDays, 
    formatPaymentTerms, 
    computeDueDate, 
    calculateDaysOverdue, 
    formatDueDate 
};
