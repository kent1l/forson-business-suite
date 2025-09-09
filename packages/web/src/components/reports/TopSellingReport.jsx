import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TopSellingReport = () => {
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dates, setDates] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
        };
    });
    const [sortBy, setSortBy] = useState('revenue');

    const handleDateChange = (e) => {
        const { name, value } = e.target;
        setDates(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = async (format = 'json') => {
        if (!dates.startDate || !dates.endDate) {
            return toast.error('Please select both a start and end date.');
        }
        
        if (format === 'json') setLoading(true);

        try {
            const response = await api.get('/reports/top-selling', {
                params: { ...dates, sortBy, format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });

            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `top-selling-report-${dates.startDate}-to-${dates.endDate}.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
                toast.success('Report exported successfully!');
            } else {
                setReportData(response.data);
            }
        } catch {
            toast.error('Failed to generate report.');
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    return (
        <>
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                            <option value="revenue">Revenue</option>
                            <option value="quantity">Quantity</option>
                        </select>
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300">
                            {loading ? 'Loading...' : 'View Report'}
                        </button>
                         <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300">
                            Export CSV
                        </button>
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Item Name</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-center">Qty Sold</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((row, index) => (
                                <tr key={index} className="border-b hover:bg-gray-50">
                                    <td className="p-3 text-sm font-mono">{row.internal_sku}</td>
                                    <td className="p-3 text-sm">{row.display_name}</td>
                                    <td className="p-3 text-sm text-center font-semibold">{Number(row.total_quantity_sold).toLocaleString()}</td>
                                    <td className="p-3 text-sm text-right font-mono">₱{parseFloat(row.total_revenue).toFixed(2)}</td>
                                </tr>
                            ))}
                             {reportData.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="4" className="p-4 text-center text-gray-500">No sales data for the selected period.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
};

export default TopSellingReport;
