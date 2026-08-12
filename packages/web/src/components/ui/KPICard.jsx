import Icon from './Icon';
import { ICONS } from '../../constants';

/**
 * Unified KPI/stat card used across the Dashboard, A/R, A/P, and PDC views.
 * Two icon conventions are supported so both existing call sites keep working:
 *  - `icon`: short semantic key ('currency' | 'invoice' | 'package' | 'warning' | 'receipt')
 *  - `iconName`: a raw SVG path string (e.g. ICONS.dollar), as used by the A/R page today.
 *
 * Two trend conventions are also supported:
 *  - `trend` + `trendColorClass`: freeform trend text with a color (A/R page usage).
 *  - `change` + `trendDirection` ('up' | 'down'): a delta value with a directional arrow (Dashboard usage).
 *
 * The figure is the hero of this card: it is set large, in tabular figures, so
 * that a column of cards can be read down without digits shifting position.
 */

const ICON_ALIASES = {
    currency: ICONS.dollar,
    invoice: ICONS.invoice,
    package: ICONS.inventory,
    warning: ICONS.warning,
    receipt: ICONS.receipt,
};

// Each variant supplies only the icon chip's tint - the card surface itself
// stays neutral in every variant so a row of cards reads as one system rather
// than a row of competing colored panels.
const COLOR_VARIANTS = {
    gray: 'bg-neutral-100 text-neutral-500 dark:bg-slate-700 dark:text-slate-300',
    green: 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400',
    blue: 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
    purple: 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-400',
    orange: 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-400',
    red: 'bg-danger-50 text-danger-600 dark:bg-danger-900/30 dark:text-danger-400',
    amber: 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-400',
    emerald: 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400',
    rose: 'bg-danger-50 text-danger-600 dark:bg-danger-900/30 dark:text-danger-400',
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
            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-card animate-pulse">
                <div className="flex items-start justify-between mb-4">
                    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded"></div>
                    <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-700"></div>
                </div>
                <div className="h-8 w-28 bg-slate-200 dark:bg-slate-700 rounded mb-3"></div>
                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded"></div>
            </div>
        );
    }

    const iconPath = iconName || ICON_ALIASES[icon] || ICONS.dashboard;
    const chipClass = COLOR_VARIANTS[color] || COLOR_VARIANTS.gray;
    const isInteractive = Boolean(onClick);

    // A real <button> can only legally contain phrasing content, and this card
    // holds a heading, so the interactive version is a div carrying the button
    // role plus the keyboard behaviour a button would have given us for free.
    const interactiveProps = isInteractive
        ? {
            onClick,
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(e);
                }
            },
        }
        : {};

    return (
        <div
            {...interactiveProps}
            className={`
                group relative w-full text-left bg-white dark:bg-slate-800 p-5 rounded-xl
                border border-slate-200/80 dark:border-slate-700 shadow-card
                transition-all duration-200
                ${isInteractive ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950' : ''}
                ${urgent ? 'ring-1 ring-warning-500/60 dark:ring-warning-500/40' : ''}
            `}
        >
            <div className="flex items-start justify-between gap-3 mb-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight pt-1">
                    {title}
                </h3>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${chipClass}`}>
                    <Icon path={iconPath} className="h-[18px] w-[18px]" />
                </div>
            </div>

            <p className="tnum text-[28px] leading-none font-bold tracking-tight text-slate-900 dark:text-slate-50">
                {formatValue(value, isMonetary)}
            </p>

            <div className="flex items-center gap-2 flex-wrap mt-3 min-h-[20px]">
                {change != null && trendDirection && (
                    <span className={`tnum inline-flex items-center gap-0.5 pl-1 pr-1.5 py-0.5 rounded-md text-xs font-semibold ${
                        trendDirection === 'up'
                            ? 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                            : 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                    }`}>
                        <Icon path={trendDirection === 'up' ? ICONS.chevronUp : ICONS.chevronDown} className="h-3 w-3" />
                        {change}
                    </span>
                )}
                {urgent && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-warning-50 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400 text-xs font-semibold uppercase tracking-wide">
                        Urgent
                    </span>
                )}
                {trend && <span className={`text-xs font-medium ${trendColorClass}`}>{trend}</span>}
                {subtitle && <span className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>}
            </div>
        </div>
    );
};

export default KPICard;
