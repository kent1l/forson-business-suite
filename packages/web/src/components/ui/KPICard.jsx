import Icon from './Icon';

// A reusable KPI card component based on Dashboard.jsx styles
const KPICard = ({ iconName, title, value, trend, trendColorClass = 'text-green-500', loading = false }) => {
    if (loading) {
        return (
            <div className="bg-white p-6 rounded-lg border border-gray-200 animate-pulse">
                <div className="flex items-center gap-x-3 mb-2">
                    <div className="w-12 h-12 rounded-full bg-gray-200"></div>
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
                <div className="h-8 bg-gray-200 rounded w-20 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-32"></div>
            </div>
        );
    }

    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 flex flex-col gap-y-2">
            <div className="flex items-center gap-x-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                    <Icon path={iconName} className="h-6 w-6 text-gray-500" />
                </div>
                <h3 className="text-gray-500 font-medium">{title}</h3>
            </div>
            <p className="text-3xl font-bold text-gray-800">{value}</p>
            {trend && <p className={`text-sm ${trendColorClass}`}>{trend}</p>}
        </div>
    );
};

export default KPICard;