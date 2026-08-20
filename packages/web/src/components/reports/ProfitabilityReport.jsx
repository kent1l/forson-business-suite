import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import Combobox from '../ui/Combobox';
import PaginationControls from '../ui/PaginationControls';
import SortableHeader from '../ui/SortableHeader';
import InfoTip from '../ui/InfoTip';
import { getPaginatedPayload } from '../../utils/paginatedResponse';
import { sortData } from '../../utils/sortData';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const asArray = (value) => (Array.isArray(value) ? value : []);

const ProfitabilityReport = () => {
    const { settings } = useSettings();
    const [reportData, setReportData] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [sortConfig, setSortConfig] = useState({ key: 'total_profit', direction: 'DESC' });
    const [filters, setFilters] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
            brandId: '',
            groupId: ''
        };
    });

    useEffect(() => {
        api.get('/brands').then(res => setBrands(asArray(res.data?.data ?? res.data)));
        api.get('/groups').then(res => setGroups(asArray(res.data?.data ?? res.data)));
    }, []);
    
    const brandOptions = asArray(brands).map(b => ({ value: b.brand_id, label: b.brand_name }));
    const groupOptions = asArray(groups).map(g => ({ value: g.group_id, label: g.group_name }));

    const handleFilterChange = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value }));
        setPage(1);
    };

    const fetchReport = async (format = 'json') => {
        if (!filters.startDate || !filters.endDate) return toast.error('Please select both a start and end date.');
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/profitability-by-product', {
                params: { ...filters, format, page, pageSize, paginated: 1 },
                responseType: format === 'csv' ? 'blob' : 'json',
            });
            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `profitability-report.csv`);
                document.body.appendChild(link);
                link.click();
                link.remove();
                toast.success('Report exported successfully!');
            } else {
                const paginated = getPaginatedPayload(response.data);
                setReportData(asArray(paginated.data));
                setTotal(paginated.total);
            }
        } catch {
            toast.error('Failed to generate report.');
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    useEffect(() => {
        if (reportData.length > 0) {
            fetchReport('json');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize]);

    const sortedReportData = sortData(reportData, sortConfig);

    return (
        <>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm mb-6">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">End Date</label>
                        <input type="date" name="endDate" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Brand</label>
                        <Combobox 
                            options={[{value: '', label: 'All Brands'}, ...brandOptions]}
                            value={filters.brandId}
                            onChange={(value) => handleFilterChange('brandId', value)}
                            placeholder="Search brands..."
                        />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Group</label>
                        <Combobox 
                            options={[{value: '', label: 'All Groups'}, ...groupOptions]}
                            value={filters.groupId}
                            onChange={(value) => handleFilterChange('groupId', value)}
                            placeholder="Search groups..."
                        />
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50 cursor-pointer">View Report</button>
                        <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-success-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-success-700 transition disabled:opacity-50 cursor-pointer">Export CSV</button>
                    </div>
                </div>
            </div>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm">
                {loading ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading report...</p> : (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300">
                                <tr>
                                    <SortableHeader column="display_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Item</SortableHeader>
                                    <SortableHeader className="text-right" column="total_revenue" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Total Revenue</SortableHeader>
                                    <SortableHeader className="text-right" column="total_cost" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Total Cost</SortableHeader>
                                    <SortableHeader className="text-right" column="total_profit" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>
                                        <span className="inline-flex items-center gap-1">
                                            Total Profit
                                            <InfoTip label="Total Profit" align="right">
                                                Total Profit = Total Revenue − Total Cost, calculated per item.
                                            </InfoTip>
                                        </span>
                                    </SortableHeader>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                {sortedReportData.map((row) => (
                                    <tr key={row.internal_sku} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                        <td className="p-3 text-sm font-medium text-gray-900 dark:text-slate-100">{row.display_name}</td>
                                        <td className="p-3 text-sm text-right font-mono text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_revenue).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_cost).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono font-bold text-primary-600 dark:text-primary-400">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_profit).toFixed(2)}</td>
                                    </tr>
                                ))}
                                {sortedReportData.length === 0 && (
                                    <tr>
                                        <td colSpan="4" className="p-4 text-center text-gray-500 dark:text-slate-400">No data to display.</td>
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
                </>
                )}
            </div>
        </>
    );
};

export default ProfitabilityReport;
