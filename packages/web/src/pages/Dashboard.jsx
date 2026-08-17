import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { RefreshCw, Activity, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import KPICard from '../components/ui/KPICard';
import InfoTip from '../components/ui/InfoTip';
import { SalesTrendChart, TopProductsChart } from '../components/dashboard/AnalyticsCharts';
import { QuickActionsPanel } from '../components/dashboard/QuickActionsPanel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';

const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
};

const Dashboard = ({ onNavigate }) => {
    const { hasPermission, user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState('');
    const [timeRange, setTimeRange] = useState('30');

    // Dashboard data states
    const [enhancedStats, setEnhancedStats] = useState({
        kpis: {
            todayRevenue: { value: 0, change: null, trend: null },
            outstandingAR: { value: 0, change: null, trend: null },
            inventoryValue: { value: 0, change: null, trend: null },
            lowStockCount: { value: 0, urgent: false }
        },
        recentSales: [],
        topProducts: []
    });
    const [chartData, setChartData] = useState([]);
    const [lowStockItems, setLowStockItems] = useState([]);
    const hasLoadedRef = useRef(false);

    const fetchDashboardData = useCallback(async ({ silent = false } = {}) => {
        try {
            if (silent) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            setError('');

            const [enhancedRes, chartRes, lowStockRes] = await Promise.all([
                api.get('/dashboard/enhanced-stats'),
                api.get(`/dashboard/sales-chart?days=${timeRange}`),
                api.get('/dashboard/low-stock-items')
            ]);

            setEnhancedStats(enhancedRes.data);
            setChartData(chartRes.data);
            setLowStockItems(lowStockRes.data);
            setLastUpdated(new Date());
        } catch (err) {
            setError('Failed to load dashboard data.');
            console.error('Dashboard data fetch error:', err);
        } finally {
            if (silent) {
                setRefreshing(false);
            } else {
                setLoading(false);
            }
        }
    }, [timeRange]);

    useEffect(() => {
        fetchDashboardData({ silent: hasLoadedRef.current });
        hasLoadedRef.current = true;
    }, [fetchDashboardData]);

    // Auto-refresh functionality
    useEffect(() => {
        let interval;
        if (autoRefresh) {
            interval = setInterval(() => {
                fetchDashboardData({ silent: true });
            }, 30000); // Refresh every 30 seconds
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [autoRefresh, fetchDashboardData]);

    const handleNavigation = (path) => {
        if (onNavigate) {
            onNavigate(path);
        }
    };

    const handleRefresh = () => {
        fetchDashboardData({ silent: true });
    };

    const formatLastUpdated = () => {
        return lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (error) {
        return (
            <div className="flex items-start gap-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-900/50 rounded-xl p-4 text-danger-700 dark:text-danger-400">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                    <p className="font-medium">Error loading dashboard</p>
                    <p className="text-sm">{error}</p>
                    <button
                        onClick={handleRefresh}
                        className="mt-3 bg-danger-100 dark:bg-danger-900/40 hover:bg-danger-200 dark:hover:bg-danger-900/60 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-tight">
                        {getGreeting()}{user?.first_name ? `, ${user.first_name}` : ''}
                    </h1>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                        <Activity className={`h-3.5 w-3.5 ${refreshing ? 'animate-pulse text-primary-500' : ''}`} />
                        <span className="inline-flex items-center gap-1">
                            Updated {formatLastUpdated()}
                            <InfoTip label="Updated time">
                                This reflects the last time the data below was loaded or refreshed — not the current clock time.
                            </InfoTip>
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={autoRefresh}
                        onClick={() => setAutoRefresh((v) => !v)}
                        className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${
                            autoRefresh
                                ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-900/50 text-primary-700 dark:text-primary-400'
                                : 'bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                        <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${autoRefresh ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${autoRefresh ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                        </span>
                        Auto-refresh
                    </button>

                    <button
                        onClick={handleRefresh}
                        disabled={loading || refreshing}
                        className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${(loading || refreshing) ? 'animate-spin' : ''}`} />
                        <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
                    </button>
                </div>
            </header>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {hasPermission('invoicing:create') && (
                    <KPICard
                        title="Today's Revenue"
                        value={enhancedStats.kpis.todayRevenue.value}
                        change={enhancedStats.kpis.todayRevenue.change}
                        trendDirection={enhancedStats.kpis.todayRevenue.trend}
                        icon="currency"
                        color="green"
                        loading={loading}
                        onClick={() => handleNavigation('sales_history')}
                        isMonetary
                    />
                )}
                {hasPermission('ar:view') && (
                    <KPICard
                        title="Outstanding A/R"
                        value={enhancedStats.kpis.outstandingAR.value}
                        icon="invoice"
                        color="blue"
                        loading={loading}
                        onClick={() => handleNavigation('ar')}
                        subtitle="Unpaid invoices"
                        isMonetary
                    />
                )}
                {hasPermission('inventory:view') && (
                    <KPICard
                        title="Inventory Value"
                        value={enhancedStats.kpis.inventoryValue.value}
                        icon="package"
                        color="purple"
                        loading={loading}
                        onClick={() => handleNavigation('inventory')}
                        subtitle="Total stock value"
                        isMonetary
                    />
                )}
                {hasPermission('inventory:view') && (
                    <KPICard
                        title="Low Stock Alert"
                        value={`${enhancedStats.kpis.lowStockCount?.value || 0} items`}
                        icon="warning"
                        color="orange"
                        urgent={enhancedStats.kpis.lowStockCount?.urgent}
                        loading={loading}
                        onClick={() => handleNavigation('inventory')}
                    />
                )}
                {hasPermission('expenses:view') && (
                    <KPICard
                        title="Monthly Expenses"
                        value={enhancedStats.kpis.totalExpensesMonth?.value || 0}
                        icon="receipt"
                        color="red"
                        loading={loading}
                        onClick={() => handleNavigation('expenses')}
                        subtitle="Current month operating cost"
                        isMonetary
                    />
                )}
            </div>

            {/* Quick Actions */}
            <QuickActionsPanel onNavigate={handleNavigation} />

            {/* Charts */}
            {(hasPermission('reports:view') || hasPermission('invoicing:create') || hasPermission('inventory:view')) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {(hasPermission('invoicing:create') || hasPermission('reports:view')) && (
                        <SalesTrendChart
                            data={chartData}
                            loading={loading}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                        />
                    )}
                    {(hasPermission('inventory:view') || hasPermission('reports:view')) && (
                        <TopProductsChart
                            data={enhancedStats.topProducts}
                            loading={loading}
                        />
                    )}
                </div>
            )}

            {/* Recent Activity */}
            <RecentActivityFeed
                recentSales={enhancedStats.recentSales}
                lowStockItems={lowStockItems}
                loading={loading}
                onViewAllSales={() => handleNavigation('sales_history')}
                onManageStock={() => handleNavigation('inventory')}
            />
        </div>
    );
};

export default Dashboard;
