import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import { Calendar, TrendingUp, PackageSearch } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

// Chart surfaces don't respond to Tailwind's `dark:` classes (SVG/canvas is
// painted by recharts via inline styles), so colors are picked in JS from the
// resolved theme mode instead.
const CHART_THEME = {
    light: {
        grid: '#e2e8f0',
        tick: '#64748b',
        line: '#2563eb',
        bar: '#8f56f0',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e2e8f0',
        tooltipLabel: '#64748b',
    },
    dark: {
        grid: '#334155',
        tick: '#94a3b8',
        line: '#60a5fa',
        bar: '#a78bfa',
        tooltipBg: '#1e293b',
        tooltipBorder: '#334155',
        tooltipLabel: '#94a3b8',
    },
};

const useChartTheme = () => {
    const { mode } = useTheme() || {};
    return CHART_THEME[mode === 'dark' ? 'dark' : 'light'];
};

const CustomTooltip = ({ active, payload, label, formatter, theme }) => {
    if (active && payload && payload.length) {
        return (
            <div
                className="p-3 rounded-lg shadow-lg border text-sm"
                style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder }}
            >
                <p className="mb-1" style={{ color: theme.tooltipLabel }}>{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} className="font-medium" style={{ color: entry.color }}>
                        {formatter ? formatter(entry.value, entry.name) : `${entry.name}: ${entry.value}`}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const CardShell = ({ title, icon: Icon, headerRight, children }) => (
    <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 h-80 flex flex-col shadow-card">
        <div className="flex justify-between items-center gap-3 mb-5 flex-shrink-0">
            <div className="flex items-center gap-2">
                {Icon && <Icon className="h-4 w-4 text-slate-400 dark:text-slate-500" />}
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{title}</h3>
            </div>
            {headerRight}
        </div>
        {children}
    </div>
);

export const SalesTrendChart = ({ data, loading, timeRange, onTimeRangeChange }) => {
    const theme = useChartTheme();

    return (
        <CardShell
            title="Sales Trend"
            icon={TrendingUp}
            headerRight={
                <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    <select
                        value={timeRange}
                        onChange={(e) => onTimeRangeChange && onTimeRangeChange(e.target.value)}
                        className="text-xs font-medium border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="30">Last 30 Days</option>
                        <option value="90">Last 90 Days</option>
                        <option value="365">This Year</option>
                    </select>
                </div>
            }
        >
            {loading ? (
                <div className="flex-1 bg-gray-100 dark:bg-slate-700/50 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400 dark:text-slate-500">Loading chart data...</div>
                </div>
            ) : (
                <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                            <XAxis
                                dataKey="date"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: theme.tick }}
                            />
                            <YAxis
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: theme.tick }}
                                tickFormatter={(value) => `₱${(value / 1000).toFixed(0)}K`}
                            />
                            <Tooltip
                                cursor={{ stroke: theme.grid, strokeWidth: 1 }}
                                content={(props) => CustomTooltip({ ...props, theme, formatter: (value) => [`₱${Number(value).toLocaleString()}`, 'Sales'] })}
                            />
                            <Line
                                type="monotone"
                                dataKey="total_sales"
                                stroke={theme.line}
                                strokeWidth={2}
                                dot={{ fill: theme.line, strokeWidth: 0, r: 3 }}
                                activeDot={{ r: 5, stroke: theme.line, strokeWidth: 2, fill: theme.tooltipBg }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </CardShell>
    );
};

export const TopProductsChart = ({ data, loading }) => {
    // Filter out any items with zero or null revenue and sort by revenue descending
    const validData = data?.filter(item => item.total_revenue > 0)
        .sort((a, b) => b.total_revenue - a.total_revenue) || [];

    return (
        <CardShell
            title="Top Selling Products"
            headerRight={<span className="text-xs font-medium text-slate-500 dark:text-slate-400">Last 30 Days</span>}
        >
            {loading ? (
                <div className="flex-1 space-y-3 overflow-hidden">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                            <div className="flex items-center space-x-3">
                                <div className="w-6 h-6 bg-gray-200 dark:bg-slate-600 rounded-full"></div>
                                <div className="w-32 h-4 bg-gray-200 dark:bg-slate-600 rounded"></div>
                            </div>
                            <div className="flex space-x-6 text-right">
                                <div className="w-12 h-4 bg-gray-200 dark:bg-slate-600 rounded"></div>
                                <div className="w-16 h-4 bg-gray-200 dark:bg-slate-600 rounded"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : validData.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-slate-400">
                    <div className="text-center">
                        <PackageSearch className="h-10 w-10 mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                        <p className="font-medium">No sales data</p>
                        <p className="text-sm">Top products will appear here</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col min-h-0">
                    {/* Column headers - the rank column is unlabelled because the
                        ordering is self-evident from the list itself. */}
                    <div className="flex justify-between items-center px-2 pb-2 mb-1 border-b border-slate-100 dark:border-slate-700 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex-shrink-0">
                        <div className="flex items-center gap-3 flex-1">
                            <span className="w-5"></span>
                            <span>Product</span>
                        </div>
                        <div className="flex gap-4 text-right">
                            <span className="w-10">Sold</span>
                            <span className="w-20">Revenue</span>
                        </div>
                    </div>

                    {/* Scrollable Product List */}
                    <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin -mx-1">
                        {validData.map((product, index) => (
                            <div key={index} className="flex justify-between items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <span className={`tnum w-5 text-xs font-semibold flex-shrink-0 text-right ${
                                        index < 3 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'
                                    }`}>
                                        {index + 1}
                                    </span>
                                    <p className="flex-1 min-w-0 text-xs font-medium text-slate-700 dark:text-slate-200 truncate" title={product.product_name}>
                                        {product.product_name}
                                    </p>
                                </div>
                                <div className="flex gap-4 text-right flex-shrink-0">
                                    <span className="tnum w-10 text-xs text-slate-500 dark:text-slate-400">
                                        {parseFloat(product.total_quantity).toFixed(0)}
                                    </span>
                                    <span className="tnum w-20 text-xs font-semibold text-slate-900 dark:text-slate-100">
                                        ₱{Number(product.total_revenue).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </CardShell>
    );
};

export const InventoryChart = ({ data, loading }) => {
    const theme = useChartTheme();

    return (
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-card">
            <div className="flex justify-between items-center mb-5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">Inventory Distribution</h3>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">By Category</span>
            </div>

            {loading ? (
                <div className="h-80 bg-gray-100 dark:bg-slate-700/50 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400 dark:text-slate-500">Loading inventory...</div>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
                        <XAxis
                            dataKey="category"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: theme.tick }}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                        />
                        <YAxis
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: theme.tick }}
                        />
                        <Tooltip
                            cursor={{ fill: theme.grid, opacity: 0.3 }}
                            content={(props) => CustomTooltip({
                                ...props, theme, formatter: (value, name) => {
                                    if (name === 'value') return [`₱${Number(value).toLocaleString()}`, 'Value'];
                                    if (name === 'quantity') return [`${value} items`, 'Quantity'];
                                    return [value, name];
                                }
                            })}
                        />
                        <Bar dataKey="value" fill={theme.bar} radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};
