import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Package, AlertTriangle, FileText } from 'lucide-react';

const iconMap = {
    currency: DollarSign,
    package: Package,
    warning: AlertTriangle,
    invoice: FileText,
    trendUp: TrendingUp,
    trendDown: TrendingDown,
};

const colorVariants = {
    green: {
        bg: 'bg-green-50',
        iconBg: 'bg-green-100',
        iconColor: 'text-green-600',
        accent: 'border-green-200',
        trendUp: 'text-green-600',
        trendDown: 'text-red-500',
    },
    blue: {
        bg: 'bg-blue-50',
        iconBg: 'bg-blue-100',
        iconColor: 'text-blue-600',
        accent: 'border-blue-200',
        trendUp: 'text-green-600',
        trendDown: 'text-red-500',
    },
    purple: {
        bg: 'bg-purple-50',
        iconBg: 'bg-purple-100',
        iconColor: 'text-purple-600',
        accent: 'border-purple-200',
        trendUp: 'text-green-600',
        trendDown: 'text-red-500',
    },
    orange: {
        bg: 'bg-orange-50',
        iconBg: 'bg-orange-100',
        iconColor: 'text-orange-600',
        accent: 'border-orange-200',
        trendUp: 'text-green-600',
        trendDown: 'text-red-500',
    },
    red: {
        bg: 'bg-red-50',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
        accent: 'border-red-200',
        trendUp: 'text-green-600',
        trendDown: 'text-red-500',
    },
};

const EnhancedKPICard = ({ 
    title, 
    value, 
    change, 
    trend, 
    icon = 'package', 
    color = 'blue', 
    urgent = false,
    loading = false,
    onClick,
    subtitle
}) => {
    const colors = colorVariants[color];
    
    const cardClasses = `
        ${urgent ? 'ring-2 ring-orange-400 ring-opacity-50' : ''}
        ${onClick ? 'cursor-pointer hover:shadow-lg transform hover:-translate-y-1 transition-all duration-200' : ''}
        bg-white p-6 rounded-xl border ${colors.accent} shadow-sm hover:shadow-md transition-shadow duration-200
    `;

    const formatValue = (val) => {
        if (typeof val === 'number') {
            if (val >= 1000000) {
                return `₱${(val / 1000000).toFixed(1)}M`;
            } else if (val >= 1000) {
                return `₱${(val / 1000).toFixed(0)}K`;
            } else if (val < 1000 && val > 0 && icon === 'currency') {
                return `₱${val.toLocaleString()}`;
            }
            return val.toLocaleString();
        }
        return val;
    };

    return (
        <div className={cardClasses} onClick={onClick}>
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-3">
                        <div className={`w-12 h-12 rounded-xl ${colors.iconBg} flex items-center justify-center`}>
                            {iconMap[icon] && React.createElement(iconMap[icon], {
                                className: `h-6 w-6 ${colors.iconColor}`
                            })}
                        </div>
                        {urgent && (
                            <div className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">
                                URGENT
                            </div>
                        )}
                    </div>
                    
                    <div>
                        <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
                        {loading ? (
                            <div className="h-8 w-24 bg-gray-200 rounded animate-pulse"></div>
                        ) : (
                            <>
                                <p className="text-2xl font-bold text-gray-900 mb-1">
                                    {formatValue(value)}
                                </p>
                                {subtitle && (
                                    <p className="text-xs text-gray-500">{subtitle}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
                
                {change && trend && !loading && (
                    <div className="flex items-center space-x-1">
                        {React.createElement(trend === 'up' ? TrendingUp : TrendingDown, {
                            className: `h-4 w-4 ${trend === 'up' ? colors.trendUp : colors.trendDown}`
                        })}
                        <span 
                            className={`text-sm font-medium ${trend === 'up' ? colors.trendUp : colors.trendDown}`}
                        >
                            {change}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnhancedKPICard;