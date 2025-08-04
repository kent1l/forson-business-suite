import React, { useState, useEffect } from 'react';
import axios from 'axios';
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
    const [stats, setStats] = useState({
        totalParts: 0,
        lowStockItems: 0,
        pendingOrders: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchStats = async () => {
            try {
                setLoading(true);
                const response = await axios.get('http://localhost:3001/api/dashboard/stats');
                setStats(response.data);
            } catch (err) {
                setError('Failed to load dashboard data.');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    if (error) {
        return <p className="text-red-500">{error}</p>;
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Dashboard</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <DashboardCard 
                    title="Total Parts" 
                    value={stats.totalParts.toLocaleString()} 
                    icon={ICONS.box} 
                    color={{bg: 'bg-blue-100', text: 'text-blue-600'}} 
                    loading={loading}
                />
                <DashboardCard 
                    title="Low Stock Items" 
                    value={stats.lowStockItems} 
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
        </div>
    );
};

export default Dashboard;
