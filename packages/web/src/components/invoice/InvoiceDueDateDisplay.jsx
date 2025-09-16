// Invoice Due Date Component
// Displays due date information with overdue indicators and payment term details

import { formatDueDate, calculateDaysOverdue, formatPaymentTerms } from '../../utils/terms';

const InvoiceDueDateDisplay = ({ 
    invoice, 
    showDetails = true, 
    className = '',
    compactMode = false 
}) => {
    const { due_date, payment_terms_days, terms, status } = invoice;
    
    // Don't show due date info for paid invoices unless explicitly requested
    if (status === 'Paid' && !showDetails) {
        return null;
    }

    const daysOverdue = calculateDaysOverdue(due_date);
    const isOverdue = daysOverdue > 0;
    const hasTerms = payment_terms_days !== null || terms;

    // Determine styling based on status
    const getStatusClasses = () => {
        if (!due_date || status === 'Paid') {
            return 'text-gray-600';
        }
        
        if (isOverdue) {
            if (daysOverdue <= 30) {
                return 'text-orange-600 bg-orange-50 border-orange-200';
            } else if (daysOverdue <= 60) {
                return 'text-red-600 bg-red-50 border-red-200';
            } else {
                return 'text-red-800 bg-red-100 border-red-300 font-semibold';
            }
        } else if (daysOverdue >= -7) {
            return 'text-yellow-600 bg-yellow-50 border-yellow-200';
        }
        
        return 'text-green-600 bg-green-50 border-green-200';
    };

    const statusClasses = getStatusClasses();
    const isPadded = statusClasses.includes('bg-');

    if (compactMode) {
        return (
            <div className={`inline-flex items-center space-x-2 ${className}`}>
                {due_date && (
                    <span className={`text-sm ${statusClasses} ${isPadded ? 'px-2 py-1 rounded border' : ''}`}>
                        {formatDueDate(due_date, { showOverdue: true })}
                    </span>
                )}
                {hasTerms && !due_date && (
                    <span className="text-sm text-gray-500">
                        {formatPaymentTerms(payment_terms_days) || terms}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className={`space-y-1 ${className}`}>
            {/* Payment Terms */}
            {hasTerms && (
                <div className="text-sm text-gray-600">
                    <span className="font-medium">Terms:</span>{' '}
                    {formatPaymentTerms(payment_terms_days) || terms}
                </div>
            )}
            
            {/* Due Date */}
            {due_date ? (
                <div className={`text-sm ${statusClasses} ${isPadded ? 'px-3 py-2 rounded border' : ''}`}>
                    <div className="flex items-center justify-between">
                        <span>
                            <span className="font-medium">Due:</span>{' '}
                            {formatDueDate(due_date, { showOverdue: false })}
                        </span>
                        {isOverdue && (
                            <span className="ml-2 font-semibold">
                                {daysOverdue} days overdue
                            </span>
                        )}
                        {!isOverdue && daysOverdue < 0 && Math.abs(daysOverdue) <= 7 && (
                            <span className="ml-2 text-xs">
                                {Math.abs(daysOverdue)} days remaining
                            </span>
                        )}
                    </div>
                </div>
            ) : hasTerms ? (
                <div className="text-sm text-gray-500">
                    No specific due date calculated
                </div>
            ) : (
                <div className="text-sm text-gray-400">
                    No payment terms specified
                </div>
            )}
            
            {/* Additional info for overdue invoices */}
            {isOverdue && showDetails && (
                <div className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded">
                    {daysOverdue <= 30 && '⚠️ Recently overdue - consider follow-up'}
                    {daysOverdue > 30 && daysOverdue <= 60 && '🔴 Significantly overdue - urgent follow-up needed'}
                    {daysOverdue > 60 && '🚨 Severely overdue - escalation recommended'}
                </div>
            )}
        </div>
    );
};

export default InvoiceDueDateDisplay;