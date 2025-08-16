import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import Combobox from '../ui/Combobox';

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

export default ProfitabilityReport;
