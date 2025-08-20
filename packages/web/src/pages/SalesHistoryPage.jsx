import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSettings } from '../contexts/SettingsContext';
import DateRangeShortcuts from '../components/ui/DateRangeShortcuts';

const SalesHistoryPage = () => {
    const { settings } = useSettings();
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dates, setDates] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
    });

    const fetchInvoices = async () => {
        setLoading(true);
        try {
            const response = await api.get('/invoices', { params: dates });
            setInvoices(response.data);
        } catch (err) {
            toast.error('Failed to fetch sales history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInvoices();
    }, [dates]);

    const handleDateChange = (e) => {
        setDates(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Sales History</h1>

            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div className="md:col-span-3">
                       <DateRangeShortcuts onSelect={setDates} />
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Invoice #</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Date</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Customer</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Employee</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map(invoice => (
                                    <tr key={invoice.invoice_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{invoice.invoice_number}</td>
                                        <td className="p-3 text-sm">{new Date(invoice.invoice_date).toLocaleDateString()}</td>
                                        <td className="p-3 text-sm">{invoice.customer_first_name} {invoice.customer_last_name}</td>
                                        <td className="p-3 text-sm">{invoice.employee_first_name}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(invoice.total_amount).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SalesHistoryPage;