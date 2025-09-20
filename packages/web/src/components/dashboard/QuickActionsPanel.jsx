import { Plus, Package, Search, BarChart3, FileText, Truck, Users, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const QuickActionButton = ({ 
    icon: Icon, 
    title, 
    description, 
    onClick, 
    color = 'blue',
    disabled = false 
}) => {
    const colorVariants = {
        blue: {
            bg: 'bg-blue-50 hover:bg-blue-100',
            icon: 'text-blue-600',
            border: 'border-blue-200',
            shadow: 'hover:shadow-blue-100',
        },
        green: {
            bg: 'bg-green-50 hover:bg-green-100',
            icon: 'text-green-600',
            border: 'border-green-200',
            shadow: 'hover:shadow-green-100',
        },
        purple: {
            bg: 'bg-purple-50 hover:bg-purple-100',
            icon: 'text-purple-600',
            border: 'border-purple-200',
            shadow: 'hover:shadow-purple-100',
        },
        orange: {
            bg: 'bg-orange-50 hover:bg-orange-100',
            icon: 'text-orange-600',
            border: 'border-orange-200',
            shadow: 'hover:shadow-orange-100',
        },
        gray: {
            bg: 'bg-gray-50 hover:bg-gray-100',
            icon: 'text-gray-600',
            border: 'border-gray-200',
            shadow: 'hover:shadow-gray-100',
        },
    };

    const colors = colorVariants[color];

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                ${colors.bg} ${colors.border} ${colors.shadow}
                border rounded-xl p-4 text-left transition-all duration-200 
                transform hover:-translate-y-1 hover:shadow-lg
                disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
                w-full group
            `}
        >
            <div className="flex flex-col items-center space-y-3 min-h-[100px]">
                <div className={`w-12 h-12 rounded-lg ${colors.bg} flex items-center justify-center`}>
                    <Icon className={`h-6 w-6 ${colors.icon}`} />
                </div>
                <div className="text-center">
                    <h4 className="font-semibold text-gray-800 text-sm">{title}</h4>
                    <p className="text-xs text-gray-600 mt-1">{description}</p>
                </div>
            </div>
        </button>
    );
};

export const QuickActionsPanel = ({ onNavigate }) => {
    const { hasPermission } = useAuth();
    
    const actions = [
        {
            icon: Plus,
            title: 'New Invoice',
            description: 'Create new invoice',
            color: 'blue',
            path: 'invoicing',
            permission: 'invoicing:create',
        },
        {
            icon: Package,
            title: 'Add Stock',
            description: 'Goods receipt',
            color: 'green',
            path: 'goods_receipt',
            permission: 'goods_receipt:create',
        },
        {
            icon: Search,
            title: 'Find Parts',
            description: 'Power search',
            color: 'purple',
            path: 'power_search',
            permission: 'parts:view',
        },
        {
            icon: BarChart3,
            title: 'Reports',
            description: 'View analytics',
            color: 'orange',
            path: 'reporting',
            permission: 'reports:view',
        },
        {
            icon: FileText,
            title: 'Documents',
            description: 'Manage files',
            color: 'gray',
            path: 'documents',
            permission: 'documents:view',
        },
        {
            icon: Truck,
            title: 'Orders',
            description: 'Track orders',
            color: 'blue',
            path: 'purchase_orders',
            permission: 'purchase_orders:view',
        },
        {
            icon: Users,
            title: 'Customers',
            description: 'Manage customers',
            color: 'green',
            path: 'customers',
            permission: 'customers:view',
        },
        {
            icon: Settings,
            title: 'Settings',
            description: 'Configuration',
            color: 'gray',
            path: 'settings',
            permission: 'settings:view',
        },
    ];

    // Filter actions based on user permissions
    const allowedActions = actions.filter(action => hasPermission(action.permission));

    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Quick Actions</h3>
                <span className="text-sm text-gray-500">Common tasks</span>
            </div>
            
            {allowedActions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <Settings className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No quick actions available</p>
                    <p className="text-sm text-gray-400 mt-1">Contact your administrator for access</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                    {allowedActions.map((action, index) => (
                        <QuickActionButton
                            key={index}
                            icon={action.icon}
                            title={action.title}
                            description={action.description}
                            color={action.color}
                            onClick={() => onNavigate && onNavigate(action.path)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default QuickActionsPanel;