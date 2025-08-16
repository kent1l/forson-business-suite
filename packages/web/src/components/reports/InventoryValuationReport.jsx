import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';

const InventoryValuationReport = () => {
    const { settings } = useSettings();
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchReport = async (format = 'json') => {
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/inventory-valuation', {
                params: { format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });

            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'inventory-valuation-report.csv');
                document.body.appendChild(link);
                link.click();
                link.remove();
                toast.success('Report exported successfully!');
            } else {
                setReportData(response.data);
            }
        } catch (err) {
            toast.error('Failed to generate report.');
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, []);

    const grandTotal = reportData.reduce((acc, row) => acc + parseFloat(row.total_value), 0);

    return (
        <>
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6 flex justify-between items-center">
                <p className="text-lg">This report provides a snapshot of your current inventory's total value.</p>
                <button onClick={() => fetchReport('csv')} disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300">
                    Export CSV
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading report...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Stock on Hand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">WAC</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row, index) => (
                                    <tr key={index} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{row.internal_sku}</td>
                                        <td className="p-3 text-sm">{row.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{Number(row.stock_on_hand).toLocaleString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.wac_cost).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_value).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="font-bold">
                                <tr>
                                    <td colSpan="4" className="p-3 text-right text-blue-600">Grand Total Inventory Value:</td>
                                    <td className="p-3 text-right font-mono text-blue-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{grandTotal.toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

export default InventoryValuationReport;
