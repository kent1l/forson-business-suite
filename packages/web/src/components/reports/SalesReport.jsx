import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import { ICONS } from '../../constants';
import ReportCard from './ReportCard';
import PaginationControls from '../ui/PaginationControls';
import SortableHeader from '../ui/SortableHeader';
import InfoTip from '../ui/InfoTip';
import { getPaginatedPayload } from '../../utils/paginatedResponse';
import { sortData } from '../../utils/sortData';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import StatusMultiSelect, { ALL_STATUSES, DEFAULT_STATUSES } from '../ui/StatusMultiSelect';

const SalesReport = () => {
    const { settings } = useSettings();
    const [reportData, setReportData] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [sortConfig, setSortConfig] = useState({ key: 'invoice_date', direction: 'ASC' });
    const [dates, setDates] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
        };
    });
    const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUSES);

    const handleDateChange = (e) => {
        const { name, value } = e.target;
        setDates(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = useCallback(async (format = 'json') => {
        if (!dates.startDate || !dates.endDate) {
            return toast.error('Please select both a start and end date.');
        }

        if (format === 'json') setLoading(true);

        const statusParam = statusFilter.length > 0 && statusFilter.length < ALL_STATUSES.length
            ? statusFilter.join(',')
            : undefined;

        try {
            const response = await api.get('/reports/sales-summary', {
                params: {
                    ...dates,
                    status: statusParam,
                    format,
                    page,
                    pageSize,
                    paginated: 1,
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction
                },
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
                const paginated = getPaginatedPayload(response.data, response.data?.details?.length || 0);
                setReportData(response.data.details || paginated.data);
                setSummary(response.data.summary);
                setTotal(response.data?.total || paginated.total || 0);
            }
        } catch {
            toast.error('Failed to generate report.');
        } finally {
            if (format === 'json') setLoading(false);
        }
    }, [dates, statusFilter, page, pageSize, sortConfig]);

    useEffect(() => {
        fetchReport();
    }, [fetchReport]);

    useEffect(() => {
        setPage(1);
    }, [dates.startDate, dates.endDate, statusFilter]);

    const handleSort = (key, direction) => {
        setSortConfig({ key, direction });
        setPage(1);
    };

    return (
        <>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm mb-6">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Status</label>
                        <StatusMultiSelect selected={statusFilter} onChange={setStatusFilter} />
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
            
            {loading ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading report...</p> : summary && (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                    <ReportCard title="Total Sales" value={summary.totalSales} icon={ICONS.invoice} color={{bg: 'bg-success-100 dark:bg-success-900/30', text: 'text-success-700 dark:text-success-400'}} isCurrency={true} />
                    <ReportCard title="Total Cost" value={summary.totalCost} icon={ICONS.receipt} color={{bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400'}} isCurrency={true} />
                    <ReportCard
                        title={
                            <span className="inline-flex items-center gap-1">
                                Profit
                                <InfoTip label="Profit">
                                    Profit = Total Sales − Total Cost for the selected period.
                                </InfoTip>
                            </span>
                        }
                        value={summary.profit}
                        icon={ICONS.dashboard}
                        color={{bg: 'bg-primary-100 dark:bg-primary-900/30', text: 'text-primary-700 dark:text-primary-400'}}
                        isCurrency={true}
                    />
                    <ReportCard title="Total Invoices" value={summary.totalInvoices} icon={ICONS.parts} color={{bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-400'}} />
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300">
                            <tr>
                                <SortableHeader column="invoice_date" sortConfig={sortConfig} onSort={handleSort}>Date</SortableHeader>
                                <SortableHeader column="invoice_number" sortConfig={sortConfig} onSort={handleSort}>Invoice #</SortableHeader>
                                <SortableHeader column="display_name" sortConfig={sortConfig} onSort={handleSort}>Item</SortableHeader>
                                <SortableHeader className="text-right" column="line_total" sortConfig={sortConfig} onSort={handleSort}>Total</SortableHeader>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                            {reportData.map((row, index) => (
                                <tr key={index} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                    <td className="p-3 text-sm">{format(toZonedTime(parseISO(row.invoice_date), 'Asia/Manila'), 'MM/dd/yyyy')}</td>
                                    <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100">{row.invoice_number}</td>
                                    <td className="p-3 text-sm font-medium">{row.display_name}</td>
                                    <td className="p-3 text-sm text-right font-mono text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.line_total).toFixed(2)}</td>
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

export default SalesReport;
