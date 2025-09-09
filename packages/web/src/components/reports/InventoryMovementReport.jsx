import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Combobox from '../ui/Combobox';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const InventoryMovementReport = () => {
    const [reportData, setReportData] = useState([]);
    const [parts, setParts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
            partId: ''
        };
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
        } catch {
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
                                        <td className="p-3 text-sm whitespace-nowrap">{format(toZonedTime(parseISO(row.transaction_date), 'Asia/Manila'), 'MM/dd/yyyy hh:mm a')}</td>
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

export default InventoryMovementReport;
