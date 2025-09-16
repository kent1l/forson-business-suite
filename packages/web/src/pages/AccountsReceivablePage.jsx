import { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
// eslint-disable-next-line no-unused-vars
import Modal from '../components/ui/Modal';
// eslint-disable-next-line no-unused-vars
import ReceivePaymentForm from '../components/forms/ReceivePaymentForm';

// Utility for currency formatting
const formatCurrency = (value) => {
    const num = Number(value) || 0;
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const AccountsReceivablePage = () => {
    const { hasPermission } = useAuth();
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

    const fetchCustomersWithBalances = async () => {
        try {
            setLoading(true);
            const response = await api.get('/customers/with-balances');
            setCustomers(response.data);
        } catch (err) {
            console.error('Failed to fetch customer balances:', err);
            toast.error('Failed to fetch customer balances.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (hasPermission('ar:view')) {
            fetchCustomersWithBalances();
        }
    }, [hasPermission]);

    const handleReceivePaymentClick = (customer) => {
        setSelectedCustomer(customer);
        setIsPaymentModalOpen(true);
    };

    const handlePaymentSaved = () => {
        setIsPaymentModalOpen(false);
        fetchCustomersWithBalances(); // Refresh the list after a payment is made
    };

    if (!hasPermission('ar:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Accounts Receivable</h1>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Customer</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Balance Due</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {customers.map(customer => (
                                    <tr key={customer.customer_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm">
                                            {customer.company_name || `${customer.first_name} ${customer.last_name}`}
                                        </td>
                                        <td className="p-3 text-sm text-right font-mono">
                                            {formatCurrency(customer.balance_due)}
                                        </td>
                                        <td className="p-3 text-sm text-right">
                                            {hasPermission('ar:receive_payment') && (
                                                <button 
                                                    onClick={() => handleReceivePaymentClick(customer)}
                                                    className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-green-700 transition"
                                                >
                                                    Receive Payment
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            
            <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title={`Receive Payment from ${selectedCustomer?.company_name || selectedCustomer?.first_name}`} maxWidth="max-w-4xl">
                {selectedCustomer && (
                    <ReceivePaymentForm 
                        customer={selectedCustomer} 
                        onSave={handlePaymentSaved} 
                        onCancel={() => setIsPaymentModalOpen(false)} 
                    />
                )}
            </Modal>
        </div>
    );
};

export default AccountsReceivablePage;
