import React, { useState, useEffect } from 'react';
import api from '../api'; // Use the configured api instance
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const DashboardCard = ({ title, value, icon, color, loading }) => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 flex items-center space-x-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
            <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
        </div>
        <div>
            <h3 className="text-sm font-medium text-gray-500">{title}</h3>
            {loading ? (
                <div className="mt-2 h-8 w-16 bg-gray-200 rounded animate-pulse"></div>
            ) : (
                <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
            )}
        </div>
    </div>
);

const Dashboard = () => {
    const [stats, setStats] = useState({ totalParts: 0, lowStockItems: 0, pendingOrders: 0 });
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [statsRes, chartRes] = await Promise.all([
                    api.get('/dashboard/stats'),
                    api.get('/dashboard/sales-chart')
                ]);
                setStats(statsRes.data);
                setChartData(chartRes.data);
            } catch (err) {
                setError('Failed to load dashboard data.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (error) {
        return <p className="text-red-500">{error}</p>;
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Dashboard</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                <DashboardCard 
                    title="Total Parts" 
                    value={stats.totalParts.toLocaleString()} 
                    icon={ICONS.box} 
                    color={{bg: 'bg-blue-100', text: 'text-blue-600'}} 
                    loading={loading}
                />
                <DashboardCard 
                    title="Low Stock Items" 
                    value={stats.lowStockItems.toLocaleString()} 
                    icon={ICONS.warning} 
                    color={{bg: 'bg-yellow-100', text: 'text-yellow-600'}} 
                    loading={loading}
                />
                <DashboardCard 
                    title="Total Invoices" 
                    value={stats.pendingOrders} 
                    icon={ICONS.truck} 
                    color={{bg: 'bg-red-100', text: 'text-red-600'}} 
                    loading={loading}
                />
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Last 30 Days Sales</h3>
                {loading ? (
                    <div className="h-80 bg-gray-200 rounded animate-pulse"></div>
                ) : (
                    <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `₱${value/1000}k`} />
                                <Tooltip
                                    cursor={{ fill: 'rgba(239, 246, 255, 0.5)' }}
                                    formatter={(value) => [`₱${Number(value).toLocaleString()}`, "Sales"]}
                                />
                                <Bar dataKey="total_sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
