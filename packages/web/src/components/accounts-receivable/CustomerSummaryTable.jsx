/**
 * Customer Summary Table Component for the Forson Business Suite
 *
 * A comprehensive table component that displays customer accounts receivable data
 * including customer details, invoice counts, due dates, balances, and payment status.
 * The component provides interactive features like customer selection, payment actions,
 * and CSV export functionality. It includes loading states and permission-based
 * action visibility.
 *
 * @component
 * @param {Object} props - Component props
 * @param {Array} props.customers - Array of customer objects with AR data
 * @param {string} props.customers[].customer_id - Unique customer identifier
 * @param {string} props.customers[].company_name - Company name (if applicable)
 * @param {string} props.customers[].first_name - Customer first name
 * @param {string} props.customers[].last_name - Customer last name
 * @param {number} props.customers[].invoice_count - Number of outstanding invoices
 * @param {string} props.customers[].earliest_due_date - ISO date string of next due date
 * @param {number} props.customers[].total_balance_due - Total outstanding balance
 * @param {Function} props.onCustomerClick - Callback when customer row is clicked
 * @param {Function} props.onReceivePayment - Callback when receive payment button is clicked
 * @param {boolean} props.hasPaymentPermission - Whether user can perform payment actions
 * @param {boolean} [props.loading=false] - Whether to show loading skeleton
 * @param {Function} props.onExport - Callback for CSV export functionality
 *
 * @example
 * const customers = [
 *   {
 *     customer_id: '123',
 *     company_name: 'ABC Corp',
 *     invoice_count: 3,
 *     earliest_due_date: '2024-01-15',
 *     total_balance_due: 25000
 *   }
 * ];
 *
 * <CustomerSummaryTable
 *   customers={customers}
 *   onCustomerClick={(customer) => showCustomerDetails(customer)}
 *   onReceivePayment={(customer) => openPaymentModal(customer)}
 *   hasPaymentPermission={true}
 *   onExport={() => exportCustomerData()}
 * />
 */
import { formatCurrency } from '../../utils/currency';
import { getCustomerStatusBadge } from '../../utils/status';

// Enhanced Loading Skeleton Components
const _TableSkeleton = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
        <div className="p-6">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="border-t border-gray-200">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="px-6 py-4 border-b border-gray-200">
                    <div className="grid grid-cols-6 gap-4">
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

// Customer Summary Table Component
const CustomerSummaryTable = ({
    customers,
    onCustomerClick,
    onReceivePayment,
    hasPaymentPermission,
    loading = false,
    onExport
}) => {
    if (loading) return <_TableSkeleton />;

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-800">Customer Accounts Receivable</h2>
                <div className="flex gap-2">
                    <button
                        onClick={onExport}
                        className="text-sm px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Export CSV
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr>
                            <th scope="col" className="px-6 py-3">Customer</th>
                            <th scope="col" className="px-6 py-3">Invoice Count</th>
                            <th scope="col" className="px-6 py-3">Next Due Date</th>
                            <th scope="col" className="px-6 py-3">Total Balance</th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            {hasPaymentPermission && <th scope="col" className="px-6 py-3">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map((customer, index) => {
                            const statusBadge = getCustomerStatusBadge(customer);
                            return (
                                <tr
                                    key={customer.customer_id || index}
                                    className="bg-white border-b hover:bg-gray-50 transition-colors"
                                >
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap cursor-pointer hover:text-blue-600"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()}
                                    </td>
                                    <td className="px-6 py-4 text-center cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.invoice_count}
                                    </td>
                                    <td className="px-6 py-4 cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.earliest_due_date ? new Date(customer.earliest_due_date).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 font-mono font-medium cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {formatCurrency(customer.total_balance_due)}
                                    </td>
                                    <td className="px-6 py-4 cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusBadge.color}`}>
                                            {statusBadge.text}
                                        </span>
                                    </td>
                                    {hasPaymentPermission && (
                                        <td className="px-6 py-4">
                                            {Number(customer.total_balance_due) > 0 && (
                                                <button
                                                    onClick={() => onReceivePayment(customer)}
                                                    className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                                                >
                                                    Receive Payment
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {customers.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                    No customers with outstanding balances found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CustomerSummaryTable;