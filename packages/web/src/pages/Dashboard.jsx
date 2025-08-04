import React from 'react';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const DashboardCard = ({ title, value, icon, color }) => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 flex items-center space-x-4 transition-all hover:shadow-md hover:-translate-y-1">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color.bg}`}>
            <Icon path={icon} className={`h-6 w-6 ${color.text}`} />
        </div>
        <div>
            <h3 className="text-sm font-medium text-gray-500">{title}</h3>
            <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
        </div>
    </div>
);

const Dashboard = () => {
    const stats = {
        totalParts: 1250,
        lowStockItems: 15,
        pendingOrders: 4,
    };

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Dashboard</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <DashboardCard title="Total Parts" value={stats.totalParts.toLocaleString()} icon={ICONS.box} color={{bg: 'bg-blue-100', text: 'text-blue-600'}} />
                <DashboardCard title="Low Stock Items" value={stats.lowStockItems} icon={ICONS.warning} color={{bg: 'bg-yellow-100', text: 'text-yellow-600'}} />
                <DashboardCard title="Pending Orders" value={stats.pendingOrders} icon={ICONS.truck} color={{bg: 'bg-red-100', text: 'text-red-600'}} />
            </div>
        </div>
    );
};

export default Dashboard;