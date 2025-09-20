import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { RefreshCw, Activity } from 'lucide-react';
import EnhancedKPICard from '../components/dashboard/EnhancedKPICard';
import { SalesTrendChart, TopProductsChart } from '../components/dashboard/AnalyticsCharts';
import { QuickActionsPanel } from '../components/dashboard/QuickActionsPanel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';

const Dashboard = ({ onNavigate }) => {
    const [loading, setLoading] = useState(true);
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

    const fetchDashboardData = useCallback(async () => {
        try {
            setLoading(true);
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
            setLoading(false);
        }
    }, [timeRange]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    // Auto-refresh functionality
    useEffect(() => {
        let interval;
        if (autoRefresh) {
            interval = setInterval(() => {
                fetchDashboardData();
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
        fetchDashboardData();
    };

    const formatLastUpdated = () => {
        return lastUpdated.toLocaleTimeString();
    };

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 p-4">
                <div className="max-w-7xl mx-auto">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-600">
                        <p className="font-medium">Error loading dashboard</p>
                        <p className="text-sm">{error}</p>
                        <button 
                            onClick={handleRefresh}
                            className="mt-2 bg-red-100 hover:bg-red-200 px-3 py-1 rounded text-sm transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto p-4 space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                            <div className="flex items-center space-x-1">
                                <Activity className="h-4 w-4" />
                                <span>Last updated: {formatLastUpdated()}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center space-x-3 mt-4 sm:mt-0">
                        <label className="flex items-center space-x-2 text-sm text-gray-600">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>Auto-refresh (30s)</span>
                        </label>
                        
                        <button
                            onClick={handleRefresh}
                            disabled={loading}
                            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition-colors"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                            <span>Refresh</span>
                        </button>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <EnhancedKPICard
                        title="Today's Revenue"
                        value={enhancedStats.kpis.todayRevenue.value}
                        change={enhancedStats.kpis.todayRevenue.change}
                        trend={enhancedStats.kpis.todayRevenue.trend}
                        icon="currency"
                        color="green"
                        loading={loading}
                        onClick={() => handleNavigation('sales_history')}
                    />
                    <EnhancedKPICard
                        title="Outstanding A/R"
                        value={enhancedStats.kpis.outstandingAR.value}
                        icon="invoice"
                        color="blue"
                        loading={loading}
                        onClick={() => handleNavigation('ar')}
                        subtitle="Unpaid invoices"
                    />
                    <EnhancedKPICard
                        title="Inventory Value"
                        value={enhancedStats.kpis.inventoryValue.value}
                        icon="package"
                        color="purple"
                        loading={loading}
                        onClick={() => handleNavigation('inventory')}
                        subtitle="Total stock value"
                    />
                    <EnhancedKPICard
                        title="Low Stock Alert"
                        value={`${enhancedStats.kpis.lowStockCount.value} items`}
                        icon="warning"
                        color="orange"
                        urgent={enhancedStats.kpis.lowStockCount.urgent}
                        loading={loading}
                        onClick={() => handleNavigation('inventory')}
                    />
                </div>

                {/* Quick Actions */}
                <QuickActionsPanel onNavigate={handleNavigation} />

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SalesTrendChart
                        data={chartData}
                        loading={loading}
                        timeRange={timeRange}
                        onTimeRangeChange={setTimeRange}
                    />
                    <TopProductsChart
                        data={enhancedStats.topProducts}
                        loading={loading}
                    />
                </div>

                {/* Recent Activity */}
                <RecentActivityFeed
                    recentSales={enhancedStats.recentSales}
                    lowStockItems={lowStockItems}
                    loading={loading}
                    onViewAllSales={() => handleNavigation('sales_history')}
                    onManageStock={() => handleNavigation('inventory')}
                />
            </div>
        </div>
    );
};

export default Dashboard;
