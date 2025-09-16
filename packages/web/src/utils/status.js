// Utility functions for status calculations and badges
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