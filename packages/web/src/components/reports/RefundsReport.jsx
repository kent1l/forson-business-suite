import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import DateRangeShortcuts from '../ui/DateRangeShortcuts';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const RefundsReport = () => {
    const { settings } = useSettings();
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

    const fetchReport = useCallback(async () => {
        setLoading(true);
        try {
            // Note: This endpoint will be created in the backend reportingRoutes.js
            const response = await api.get('/reports/refunds', { params: dates });
            setReportData(response.data);
        } catch {
            toast.error('Failed to generate refunds report.');
        } finally {
            setLoading(false);
        }
    }, [dates]);

    const handleDateChange = (e) => {
        setDates(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    // Fetch report when dates change
    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    return (
        <>
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
                {loading ? <p>Loading report...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Credit Note #</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Original Invoice #</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Date</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Customer</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row) => (
                                    <tr key={row.cn_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{row.cn_number}</td>
                                        <td className="p-3 text-sm font-mono">{row.invoice_number}</td>
                                        <td className="p-3 text-sm">{format(toZonedTime(parseISO(row.refund_date), 'Asia/Manila'), 'MM/dd/yyyy')}</td>
                                        <td className="p-3 text-sm">{row.customer_name}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_amount).toFixed(2)}</td>
                                    </tr>
                                ))}
                                 {reportData.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan="5" className="p-4 text-center text-gray-500">No refunds found for the selected period.</td>
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

export default RefundsReport;