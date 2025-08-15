import React, { useState, useEffect } from 'react';
import api from '../api'; // Use the configured api instance
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import Combobox from '../components/ui/Combobox';
import { useAuth } from '../contexts/AuthContext'; // <-- NEW: Import useAuth

const ReportCard = ({ title, value, icon, color, isCurrency = false }) => {
    const { settings } = useSettings();
    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
                    <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
                </div>
                <div>
                    <h3 className="text-sm font-medium text-gray-500">{title}</h3>
                    <p className="text-2xl font-bold text-gray-800 mt-1">
                        {isCurrency ? `${settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(value).toLocaleString()}
                    </p>
                </div>
            </div>
        </div>
    );
};

const SalesReport = () => {
    const { settings } = useSettings();
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
            const response = await api.get('/reports/sales-summary', {
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
        } finally {
            if (format === 'json') setLoading(false);
        }
    };

    useEffect(() => {
        fetchReport();
    }, []);

    return (
        <>
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
                                <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map((row, index) => (
                                <tr key={index} className="border-b hover:bg-gray-50">
                                    <td className="p-3 text-sm">{new Date(row.invoice_date).toLocaleDateString()}</td>
                                    <td className="p-3 text-sm font-mono">{row.invoice_number}</td>
                                    <td className="p-3 text-sm">{row.display_name}</td>
                                    <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.line_total).toFixed(2)}</td>
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
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Last Cost</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row, index) => (
                                    <tr key={index} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{row.internal_sku}</td>
                                        <td className="p-3 text-sm">{row.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{Number(row.stock_on_hand).toLocaleString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.last_cost).toFixed(2)}</td>
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

const TopSellingReport = () => {
    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [dates, setDates] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
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
        } catch (err) {
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

const SalesByCustomerReport = () => {
    const [reportData, setReportData] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        customerId: ''
    });

    useEffect(() => {
        api.get('/customers').then(res => setCustomers(res.data));
    }, []);

    const customerOptions = customers.map(c => ({ value: c.customer_id, label: `${c.first_name} ${c.last_name}` }));

    const handleFilterChange = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = async (format = 'json') => {
        if (!filters.startDate || !filters.endDate) return toast.error('Please select both a start and end date.');
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/sales-by-customer', {
                params: { ...filters, format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });
            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `sales-by-customer.csv`);
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

    return (
        <>
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                        <Combobox 
                            options={[{value: '', label: 'All Customers'}, ...customerOptions]}
                            value={filters.customerId}
                            onChange={(value) => handleFilterChange('customerId', value)}
                            placeholder="Search customers..."
                        />
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300">View Report</button>
                        <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300">Export CSV</button>
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading report...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Customer</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Total Invoices</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Sales</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row) => (
                                    <tr key={row.customer_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{row.first_name} {row.last_name}</td>
                                        <td className="p-3 text-sm text-center">{row.total_invoices}</td>
                                        <td className="p-3 text-sm text-right font-mono">₱{parseFloat(row.total_sales).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

const InventoryMovementReport = () => {
    const [reportData, setReportData] = useState([]);
    const [parts, setParts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        partId: ''
    });

    useEffect(() => {
        api.get('/parts?status=all').then(res => setParts(res.data));
    }, []);
    
    const partOptions = parts.map(p => ({ value: p.part_id, label: p.display_name }));

    const handleFilterChange = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = async (format = 'json') => {
        if (!filters.startDate || !filters.endDate) return toast.error('Please select both a start and end date.');
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/inventory-movement', {
                params: { ...filters, format },
                responseType: format === 'csv' ? 'blob' : 'json',
            });
            if (format === 'csv') {
                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', `inventory-movement.csv`);
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
    
    return (
        <>
            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Part</label>
                        <Combobox 
                            options={[{value: '', label: 'All Parts'}, ...partOptions]}
                            value={filters.partId}
                            onChange={(value) => handleFilterChange('partId', value)}
                            placeholder="Search parts..."
                        />
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300">View Report</button>
                        <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300">Export CSV</button>
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading report...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Date</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Type</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Quantity</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Reference</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">User</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row, index) => (
                                    <tr key={index} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm whitespace-nowrap">{new Date(row.transaction_date).toLocaleString()}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{row.display_name}</td>
                                        <td className="p-3 text-sm">{row.trans_type}</td>
                                        <td className={`p-3 text-sm text-center font-semibold ${row.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{row.quantity > 0 ? `+${row.quantity}`: row.quantity}</td>
                                        <td className="p-3 text-sm font-mono">{row.reference_no}</td>
                                        <td className="p-3 text-sm">{row.employee_name}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

const ProfitabilityReport = () => {
    const { settings } = useSettings();
    const [reportData, setReportData] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        brandId: '',
        groupId: ''
    });

    useEffect(() => {
        api.get('/brands').then(res => setBrands(res.data));
        api.get('/groups').then(res => setGroups(res.data));
    }, []);
    
    const brandOptions = brands.map(b => ({ value: b.brand_id, label: b.brand_name }));
    const groupOptions = groups.map(g => ({ value: g.group_id, label: g.group_name }));

    const handleFilterChange = (name, value) => {
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const fetchReport = async (format = 'json') => {
        if (!filters.startDate || !filters.endDate) return toast.error('Please select both a start and end date.');
        if (format === 'json') setLoading(true);
        try {
            const response = await api.get('/reports/profitability-by-product', {
                params: { ...filters, format },
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
                setReportData(response.data);
            }
        } catch (err) {
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
                        <input type="date" name="startDate" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                        <Combobox 
                            options={[{value: '', label: 'All Brands'}, ...brandOptions]}
                            value={filters.brandId}
                            onChange={(value) => handleFilterChange('brandId', value)}
                            placeholder="Search brands..."
                        />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                        <Combobox 
                            options={[{value: '', label: 'All Groups'}, ...groupOptions]}
                            value={filters.groupId}
                            onChange={(value) => handleFilterChange('groupId', value)}
                            placeholder="Search groups..."
                        />
                    </div>
                    <div className="flex space-x-2">
                        <button onClick={() => fetchReport('json')} disabled={loading} className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-blue-300">View Report</button>
                        <button onClick={() => fetchReport('csv')} disabled={loading} className="w-full bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300">Export CSV</button>
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading report...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Revenue</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Cost</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Profit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reportData.map((row) => (
                                    <tr key={row.internal_sku} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{row.display_name}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_revenue).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_cost).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono font-bold text-blue-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(row.total_profit).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </>
    );
};

const ReportingPage = () => {
    const { hasPermission } = useAuth(); // <-- NEW: Use the auth context
    const [activeTab, setActiveTab] = useState('sales');

    // NEW: Protect the entire page
    if (!hasPermission('reports:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Reports</h1>
            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex space-x-6 overflow-x-auto">
                    <button onClick={() => setActiveTab('sales')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'sales' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Sales Summary</button>
                    <button onClick={() => setActiveTab('valuation')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'valuation' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Inventory Valuation</button>
                    <button onClick={() => setActiveTab('top_selling')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'top_selling' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Top-Selling Products</button>
                    <button onClick={() => setActiveTab('low_stock')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'low_stock' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Low Stock</button>
                    <button onClick={() => setActiveTab('sales_by_customer')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'sales_by_customer' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Sales by Customer</button>
                    <button onClick={() => setActiveTab('inventory_movement')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'inventory_movement' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Inventory Movement</button>
                    <button onClick={() => setActiveTab('profitability')} className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'profitability' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>Profitability by Product</button>
                </nav>
            </div>

            <div>
                {/* The individual report components will now only be rendered if the parent has permission */}
                {activeTab === 'sales' && <SalesReport />}
                {activeTab === 'valuation' && <InventoryValuationReport />}
                {activeTab === 'top_selling' && <TopSellingReport />}
                {activeTab === 'low_stock' && <LowStockReport />}
                {activeTab === 'sales_by_customer' && <SalesByCustomerReport />}
                {activeTab === 'inventory_movement' && <InventoryMovementReport />}
                {activeTab === 'profitability' && <ProfitabilityReport />}
            </div>
        </div>
    );
};

export default ReportingPage;
