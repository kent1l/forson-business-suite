/**
 * Status utility functions for the Forson Business Suite
 *
 * This module provides utility functions for calculating and displaying status badges
 * for customers and invoices in the Accounts Receivable section. It handles date
 * calculations to determine if payments are overdue, due today, or have remaining
 * days before due date, and returns appropriate color-coded status information.
 *
 * @module utils/status
 */

/**
 * Calculates the status badge for a customer based on their earliest due date
 *
 * This function determines the payment status of a customer by comparing their
 * earliest invoice due date with the current date. It returns a status object
 * containing descriptive text and Tailwind CSS classes for color coding.
 *
 * @param {Object} customer - Customer object containing earliest_due_date
 * @param {string|null} customer.earliest_due_date - ISO date string of earliest due date
 * @returns {Object} Status badge object with text and color properties
 * @returns {string} .text - Human-readable status description
 * @returns {string} .color - Tailwind CSS classes for background and text color
 *
 * @example
 * const customer = { earliest_due_date: '2024-01-15' };
 * const badge = getCustomerStatusBadge(customer);
 * // Returns: { text: '5 days remaining', color: 'bg-green-100 text-green-800' }
 */
export const getCustomerStatusBadge = (customer) => {
    if (!customer.earliest_due_date) {
        return { text: 'No due date', color: 'bg-gray-100 text-gray-800' };
    }

    const dueDate = new Date(customer.earliest_due_date);
    const today = new Date();
    const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
        return {
            text: `${Math.abs(daysDiff)} days overdue`,
            color: 'bg-red-100 text-red-800'
        };
    } else if (daysDiff === 0) {
        return {
            text: 'Due today',
            color: 'bg-orange-100 text-orange-800'
        };
    } else if (daysDiff <= 7) {
        return {
            text: `${daysDiff} days remaining`,
            color: 'bg-yellow-100 text-yellow-800'
        };
    } else {
        return {
            text: `${daysDiff} days remaining`,
            color: 'bg-green-100 text-green-800'
        };
    }
};

/**
 * Calculates the status badge for an invoice based on its due date
 *
 * This function determines the payment status of an individual invoice by comparing
 * its due date with the current date. It returns a status object with descriptive
 * text and color coding for display in the UI.
 *
 * @param {string} dueDate - ISO date string of the invoice due date
 * @returns {Object} Status badge object with text and color properties
 * @returns {string} .text - Human-readable status description
 * @returns {string} .color - Tailwind CSS classes for background and text color
 *
 * @example
 * const badge = getInvoiceStatusBadge('2024-01-15');
 * // Returns: { text: '5 days remaining', color: 'bg-green-100 text-green-800' }
 */
export const getInvoiceStatusBadge = (dueDate) => {
    const due = new Date(dueDate);
    const today = new Date();
    const daysDiff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
        return {
            text: `${Math.abs(daysDiff)} days overdue`,
            color: 'bg-red-100 text-red-800'
        };
    } else if (daysDiff === 0) {
        return {
            text: 'Due today',
            color: 'bg-orange-100 text-orange-800'
        };
    } else {
        return {
            text: `${daysDiff} days remaining`,
            color: 'bg-green-100 text-green-800'
        };
    }
};