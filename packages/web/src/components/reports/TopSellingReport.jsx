import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import PaginationControls from '../ui/PaginationControls';
import SortableHeader from '../ui/SortableHeader';
import { getPaginatedPayload } from '../../utils/paginatedResponse';
import { sortData } from '../../utils/sortData';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import StatusMultiSelect, { ALL_STATUSES, DEFAULT_STATUSES } from '../ui/StatusMultiSelect';
import DateRangeShortcuts from '../ui/DateRangeShortcuts';

const TopSellingReport = () => {
    const { settings } = useSettings();
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'total_revenue', direction: 'DESC' });
    const [dates, setDates] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
        };
    });
    const [sortBy, setSortBy] = useState('revenue');
    const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUSES);

    const handleDateChange = (e) => {
        const { name, value } = e.target;
        setDates(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = async (format = 'json') => {
        if (!dates.startDate || !dates.endDate) {
            return toast.error('Please select both a start and end date.');
        }

        if (format === 'json') setLoading(true);

        const statusParam = statusFilter.length > 0 && statusFilter.length < ALL_STATUSES.length
            ? statusFilter.join(',')
            : undefined;

        try {
            const response = await api.get('/reports/top-selling', {
                params: { ...dates, status: statusParam, sortBy, format, page, pageSize, paginated: 1 },
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
                const paginated = getPaginatedPayload(response.data);
                setReportData(paginated.data);
                setTotal(paginated.total);
                setHasLoaded(true);
            }
        } catch {
            toast.error('Failed to generate report.');
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [dates.startDate, dates.endDate, sortBy, statusFilter]);

    useEffect(() => {
        if (hasLoaded) {
            fetchReport('json');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize]);

    const sortedReportData = sortData(reportData, sortConfig);
    return (
        <>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm mb-6">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sort By</label>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500">
                            <option value="revenue">Revenue</option>
                            <option value="quantity">Quantity</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Status</label>
                        <StatusMultiSelect selected={statusFilter} onChange={setStatusFilter} />
                    </div>
                    <div className="md:col-span-3">
                        <DateRangeShortcuts onSelect={setDates} />
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50 cursor-pointer">
                            {loading ? 'Loading...' : 'View Report'}
                        </button>
                         <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-success-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-success-700 transition disabled:opacity-50 cursor-pointer">
                            Export CSV
                        </button>
                    </div>
                </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300">
                            <tr>
                                <SortableHeader column="internal_sku" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>SKU</SortableHeader>
                                <SortableHeader column="display_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Item Name</SortableHeader>
                                <SortableHeader className="text-center" column="total_quantity_sold" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Qty Sold</SortableHeader>
                                <SortableHeader className="text-right" column="total_revenue" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Total Revenue</SortableHeader>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {sortedReportData.map((row, index) => (
                                <tr key={index} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                    <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100">{row.internal_sku}</td>
                                    <td className="p-3 text-sm font-medium">{row.display_name}</td>
                                    <td className="p-3 text-sm text-center font-semibold">{Number(row.total_quantity_sold).toLocaleString()}</td>
                                    <td className="p-3 text-sm text-right font-mono font-semibold text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_revenue).toFixed(2)}</td>
                                </tr>
                            ))}
                             {reportData.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="4" className="p-4 text-center text-gray-500 dark:text-slate-400">No sales data for the selected period.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                        setPageSize(size);
                        setPage(1);
                    }}
                />
            </div>
        </>
    );
};

export default TopSellingReport;
