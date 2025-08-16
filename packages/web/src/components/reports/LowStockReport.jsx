import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const LowStockReport = () => {
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchReport = async (format = 'json') => {
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/low-stock', {
                params: { format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });

            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'low-stock-report.csv');
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

    return (
        <>
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6 flex justify-between items-center">
                <p className="text-lg">This report shows all items that are at or below their reorder point.</p>
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
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Stock on Hand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Reorder Point</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row, index) => (
                                    <tr key={index} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{row.internal_sku}</td>
                                        <td className="p-3 text-sm">{row.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold text-red-600">{Number(row.stock_on_hand).toLocaleString()}</td>
                                        <td className="p-3 text-sm text-center">{Number(row.reorder_point).toLocaleString()}</td>
                                    </tr>
                                ))}
                                {reportData.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan="4" className="p-4 text-center text-gray-500">No items are currently low on stock.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

export default LowStockReport;
