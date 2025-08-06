import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const ReportCard = ({ title, value, icon, color, isCurrency = false }) => (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex items-center space-x-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
                <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
            </div>
            <div>
                <h3 className="text-sm font-medium text-gray-500">{title}</h3>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                    {isCurrency ? `₱${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(value).toLocaleString()}
                </p>
            </div>
        </div>
    </div>
);

const ReportingPage = () => {
    const [reportData, setReportData] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dates, setDates] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
    });

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
            const response = await axios.get('http://localhost:3001/api/reports/sales-summary', {
                params: { ...dates, format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });

            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `sales-report-${dates.startDate}-to-${dates.endDate}.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
                toast.success('Report exported successfully!');
            } else {
                setReportData(response.data.details);
                setSummary(response.data.summary);
            }
        } catch (err) {
            toast.error('Failed to generate report.');
            console.error(err);
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    // Fetch the report on initial page load
    useEffect(() => {
        fetchReport();
    }, []);

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Sales Report</h1>
            
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
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
            
            {loading ? <p>Loading report...</p> : summary && (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                    <ReportCard title="Total Sales" value={summary.totalSales} icon={ICONS.invoice} color={{bg: 'bg-green-100', text: 'text-green-600'}} isCurrency={true} />
                    <ReportCard title="Total Cost" value={summary.totalCost} icon={ICONS.receipt} color={{bg: 'bg-orange-100', text: 'text-orange-600'}} isCurrency={true} />
                    <ReportCard title="Profit" value={summary.profit} icon={ICONS.dashboard} color={{bg: 'bg-blue-100', text: 'text-blue-600'}} isCurrency={true} />
                    <ReportCard title="Total Invoices" value={summary.totalInvoices} icon={ICONS.parts} color={{bg: 'bg-indigo-100', text: 'text-indigo-600'}} />
                </div>
            )}

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">Date</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Invoice #</th>
                                <th className="p-3 text-sm font-semibold text-gray-600">Part</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((row, index) => (
                                <tr key={index} className="border-b hover:bg-gray-50">
                                    <td className="p-3 text-sm">{new Date(row.invoice_date).toLocaleDateString()}</td>
                                    <td className="p-3 text-sm font-mono">{row.invoice_number}</td>
                                    <td className="p-3 text-sm">{row.part_detail}</td>
                                    <td className="p-3 text-sm text-right font-mono">₱{parseFloat(row.line_total).toFixed(2)}</td>
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
        </div>
    );
};

export default ReportingPage;
