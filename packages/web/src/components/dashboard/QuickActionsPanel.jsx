import { Plus, Package, Search, BarChart3, FileText, Truck, Users, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import InfoTip from '../ui/InfoTip';

const COLOR_VARIANTS = {
    primary: { chip: 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400' },
    success: { chip: 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400' },
    accent: { chip: 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-400' },
    warning: { chip: 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-400' },
    neutral: { chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const QuickActionButton = ({
    icon: Icon,
    title,
    description,
    onClick,
    color = 'primary',
    disabled = false
}) => {
    const colors = COLOR_VARIANTS[color] || COLOR_VARIANTS.neutral;

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={description}
            className="
                bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700
                rounded-xl p-3 transition-all duration-150
                hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-card-hover hover:-translate-y-0.5
                disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950
                w-full group
            "
        >
            <div className="flex flex-col items-center gap-2.5">
                {/* The tint lives on the icon only. Tinting whole tiles made the
                    row compete with the KPI figures above it for attention. */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-transform duration-150 group-hover:scale-105 ${colors.chip}`}>
                    <Icon className="h-[18px] w-[18px]" />
                </div>
                <h4 className="font-semibold text-slate-700 dark:text-slate-200 text-xs text-center leading-tight">{title}</h4>
            </div>
        </button>
    );
};

export const QuickActionsPanel = ({ onNavigate }) => {
    const { hasPermission } = useAuth();

    const actions = [
        {
            icon: Plus,
            title: 'New invoice',
            description: 'Create new invoice',
            color: 'primary',
            path: 'invoicing',
            permission: 'invoicing:create',
        },
        {
            icon: Package,
            title: 'Add stock',
            description: 'Goods receipt',
            color: 'success',
            path: 'goods_receipt',
            permission: 'goods_receipt:create',
        },
        {
            icon: Search,
            title: 'Find parts',
            description: 'Power search',
            color: 'accent',
            path: 'power_search',
            permission: 'parts:view',
        },
        {
            icon: BarChart3,
            title: 'Reports',
            description: 'View analytics',
            color: 'warning',
            path: 'reporting',
            permission: 'reports:view',
        },
        {
            icon: FileText,
            title: 'Documents',
            description: 'Manage files',
            color: 'neutral',
            path: 'documents',
            permission: 'documents:view',
        },
        {
            icon: Truck,
            title: 'Orders',
            description: 'Track orders',
            color: 'primary',
            path: 'purchase_orders',
            permission: 'purchase_orders:view',
        },
        {
            icon: Users,
            title: 'Customers',
            description: 'Manage customers',
            color: 'success',
            path: 'customers',
            permission: 'customers:view',
        },
        {
            icon: Settings,
            title: 'Settings',
            description: 'Configuration',
            color: 'neutral',
            path: 'settings',
            permission: 'settings:view',
        },
    ];

    // Filter actions based on user permissions
    const allowedActions = actions.filter(action => hasPermission(action.permission));

    return (
        // The action row sits directly on the page canvas rather than inside its
        // own panel - nesting cards inside a card added a frame that earned nothing.
        <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1">
                Quick actions
                <InfoTip label="Quick actions">
                    Shortcuts to common tasks so you can skip hunting through the sidebar menu. Which tiles you see depends on your permissions.
                </InfoTip>
            </h3>

            {allowedActions.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-card text-center py-8">
                    <Settings className="h-9 w-9 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No actions available to you</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Ask an administrator to grant access.</p>
                </div>
            ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
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
        </section>
    );
};

export default QuickActionsPanel;
