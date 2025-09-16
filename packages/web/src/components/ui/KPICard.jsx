// eslint-disable-next-line no-unused-vars
import Icon from './Icon';

/**
 * KPI Card Component for the Forson Business Suite
 *
 * A reusable card component for displaying Key Performance Indicators (KPIs) in dashboards.
 * This component provides a consistent design pattern for showing metrics with icons,
 * titles, values, and optional trend information. It includes loading state support
 * with skeleton animations for better user experience during data fetching.
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} props.iconName - Name/key of the icon to display from the Icon component
 * @param {string} props.title - Title text displayed below the icon
 * @param {string|number} props.value - Main KPI value to display prominently
 * @param {string} [props.trend] - Optional trend text (e.g., "+12% from last month")
 * @param {string} [props.trendColorClass='text-green-500'] - Tailwind CSS class for trend text color
 * @param {boolean} [props.loading=false] - Whether to show loading skeleton instead of content
 *
 * @example
 * // Basic KPI card
 * <KPICard
 *   iconName="dollar-sign"
 *   title="Total Revenue"
 *   value="₱125,000"
 *   trend="+15% from last month"
 * />
 *
 * @example
 * // Loading state
 * <KPICard
 *   iconName="users"
 *   title="Active Customers"
 *   loading={true}
 * />
 *
 * @example
 * // Negative trend with red color
 * <KPICard
 *   iconName="trending-down"
 *   title="Overdue Invoices"
 *   value="12"
 *   trend="-5% from last month"
 *   trendColorClass="text-red-500"
 * />
 */

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