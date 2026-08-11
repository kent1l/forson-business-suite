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
    gray: { iconBg: 'bg-gray-100', iconColor: 'text-gray-500', accent: 'border-gray-200' },
    green: { iconBg: 'bg-green-100', iconColor: 'text-green-600', accent: 'border-green-200' },
    blue: { iconBg: 'bg-blue-100', iconColor: 'text-blue-600', accent: 'border-blue-200' },
    purple: { iconBg: 'bg-purple-100', iconColor: 'text-purple-600', accent: 'border-purple-200' },
    orange: { iconBg: 'bg-orange-100', iconColor: 'text-orange-600', accent: 'border-orange-200' },
    red: { iconBg: 'bg-red-100', iconColor: 'text-red-600', accent: 'border-red-200' },
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

    const iconPath = iconName || ICON_ALIASES[icon] || ICONS.dashboard;
    const colors = COLOR_VARIANTS[color] || COLOR_VARIANTS.gray;

    return (
        <div
            onClick={onClick}
            className={`bg-white p-6 rounded-lg border ${colors.accent} flex flex-col gap-y-2 transition-shadow ${onClick ? 'cursor-pointer hover:shadow-md' : ''} ${urgent ? 'ring-2 ring-orange-400/50' : ''}`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-3">
                    <div className={`w-12 h-12 rounded-full ${colors.iconBg} flex items-center justify-center`}>
                        <Icon path={iconPath} className={`h-6 w-6 ${colors.iconColor}`} />
                    </div>
                    <h3 className="text-gray-500 font-medium">{title}</h3>
                </div>
                {urgent && (
                    <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded-full">URGENT</span>
                )}
            </div>
            <p className="text-3xl font-bold text-gray-800">{formatValue(value, isMonetary)}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
            {trend && <p className={`text-sm ${trendColorClass}`}>{trend}</p>}
            {change != null && trendDirection && (
                <p className={`text-sm font-medium flex items-center gap-1 ${trendDirection === 'up' ? 'text-green-600' : 'text-red-500'}`}>
                    <Icon path={trendDirection === 'up' ? ICONS.chevronUp : ICONS.chevronDown} className="h-3.5 w-3.5" />
                    {change}
                </p>
            )}
        </div>
    );
};

export default KPICard;
