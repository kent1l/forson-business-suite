import Icon from './Icon';
import { ICONS } from '../../constants';

/**
 * Unified KPI/stat card used across the Dashboard, A/R, and other summary views.
 * Two icon conventions are supported so both existing call sites keep working:
 *  - `icon`: short semantic key ('currency' | 'invoice' | 'package' | 'warning' | 'receipt')
 *  - `iconName`: a raw SVG path string (e.g. ICONS.dollar), as used by the A/R page today.
 *
 * Two trend conventions are also supported:
 *  - `trend` + `trendColorClass`: freeform trend text with a color (A/R page usage).
 *  - `change` + `trendDirection` ('up' | 'down'): a delta value with a directional arrow (Dashboard usage).
 */

const ICON_ALIASES = {
    currency: ICONS.dollar,
    invoice: ICONS.invoice,
    package: ICONS.inventory,
    warning: ICONS.warning,
    receipt: ICONS.receipt,
};

const COLOR_VARIANTS = {
    gray: { iconBg: 'bg-neutral-100 dark:bg-slate-700', iconColor: 'text-neutral-500 dark:text-slate-300', accent: 'border-neutral-200 dark:border-slate-700' },
    green: { iconBg: 'bg-success-100 dark:bg-success-900/30', iconColor: 'text-success-600 dark:text-success-400', accent: 'border-success-200 dark:border-success-900/50' },
    blue: { iconBg: 'bg-primary-100 dark:bg-primary-900/30', iconColor: 'text-primary-600 dark:text-primary-400', accent: 'border-primary-200 dark:border-primary-900/50' },
    purple: { iconBg: 'bg-purple-100 dark:bg-purple-900/30', iconColor: 'text-purple-600 dark:text-purple-400', accent: 'border-purple-200 dark:border-purple-900/50' },
    orange: { iconBg: 'bg-orange-100 dark:bg-orange-900/30', iconColor: 'text-orange-600 dark:text-orange-400', accent: 'border-orange-200 dark:border-orange-900/50' },
    red: { iconBg: 'bg-danger-100 dark:bg-danger-900/30', iconColor: 'text-danger-600 dark:text-danger-400', accent: 'border-danger-200 dark:border-danger-900/50' },
    amber: { iconBg: 'bg-warning-100 dark:bg-warning-900/30', iconColor: 'text-warning-600 dark:text-warning-400', accent: 'border-warning-200 dark:border-warning-900/50' },
    emerald: { iconBg: 'bg-success-100 dark:bg-success-900/30', iconColor: 'text-success-600 dark:text-success-400', accent: 'border-success-200 dark:border-success-900/50' },
    rose: { iconBg: 'bg-danger-100 dark:bg-danger-900/30', iconColor: 'text-danger-600 dark:text-danger-400', accent: 'border-danger-200 dark:border-danger-900/50' },
};

const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 });

const formatValue = (val, isMonetary) => {
    if (typeof val !== 'number') return val;
    const formatted = Math.abs(val) >= 1000 ? compactFormatter.format(val) : val.toLocaleString('en-US');
    return isMonetary ? `₱${formatted}` : formatted;
};

const KPICard = ({
    icon,
    iconName,
    title,
    value,
    trend,
    trendColorClass = 'text-green-500',
    change,
    trendDirection,
    subtitle,
    color = 'gray',
    urgent = false,
    isMonetary = false,
    onClick,
    loading = false,
}) => {
    if (loading) {
        return (
            <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-gray-200 dark:border-slate-700 animate-pulse">
                <div className="flex items-center gap-x-3 mb-2">
                    <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-slate-700"></div>
                    <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-24"></div>
                </div>
                <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-20 mb-2"></div>
                <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-32"></div>
            </div>
        );
    }

    const iconPath = iconName || ICON_ALIASES[icon] || ICONS.dashboard;
    const colors = COLOR_VARIANTS[color] || COLOR_VARIANTS.gray;

    return (
        <div
            onClick={onClick}
            className={`bg-white dark:bg-slate-800 p-6 rounded-lg border ${colors.accent} flex flex-col gap-y-2 transition-shadow ${onClick ? 'cursor-pointer hover:shadow-md' : ''} ${urgent ? 'ring-2 ring-orange-400/50' : ''}`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-3">
                    <div className={`w-12 h-12 rounded-full ${colors.iconBg} flex items-center justify-center`}>
                        <Icon path={iconPath} className={`h-6 w-6 ${colors.iconColor}`} />
                    </div>
                    <h3 className="text-gray-500 dark:text-slate-400 font-medium">{title}</h3>
                </div>
                {urgent && (
                    <span className="px-2 py-1 bg-warning-100 dark:bg-warning-900/30 text-warning-800 dark:text-warning-400 text-xs font-medium rounded-full">URGENT</span>
                )}
            </div>
            <p className="text-3xl font-bold text-gray-800 dark:text-slate-100">{formatValue(value, isMonetary)}</p>
            {subtitle && <p className="text-xs text-gray-500 dark:text-slate-400">{subtitle}</p>}
            {trend && <p className={`text-sm ${trendColorClass}`}>{trend}</p>}
            {change != null && trendDirection && (
                <p className={`text-sm font-medium flex items-center gap-1 ${trendDirection === 'up' ? 'text-success-600 dark:text-success-400' : 'text-danger-500 dark:text-danger-400'}`}>
                    <Icon path={trendDirection === 'up' ? ICONS.chevronUp : ICONS.chevronDown} className="h-3.5 w-3.5" />
                    {change}
                </p>
            )}
        </div>
    );
};

export default KPICard;
