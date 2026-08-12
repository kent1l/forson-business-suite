import { Clock, User, FileText, AlertTriangle, Package, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return `${diffInDays}d ago`;

    return date.toLocaleDateString();
};

export const RecentSalesPanel = ({ data = [], loading = false, onViewAll }) => {
    const { hasPermission } = useAuth();

    return (
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 h-[420px] flex flex-col shadow-card">
            <div className="flex justify-between items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">Recent Sales</h3>
                </div>
                {hasPermission('invoicing:create') && onViewAll && (
                    <button
                        onClick={onViewAll}
                        className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-xs font-semibold flex items-center gap-1 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                        <span>View all</span>
                        <ExternalLink className="h-3 w-3" />
                    </button>
                )}
            </div>

            {loading ? (
                <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center gap-3 px-2 py-2.5">
                            <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0"></div>
                            <div className="flex-1">
                                <div className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2"></div>
                                <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                            </div>
                            <div className="text-right">
                                <div className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-16 mb-2 ml-auto"></div>
                                <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded w-12 ml-auto"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 flex-1 flex flex-col justify-center">
                    <FileText className="h-9 w-9 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No sales yet</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Invoices you create will show up here.</p>
                </div>
            ) : (
                <div className="overflow-y-auto pr-1 flex-1 scrollbar-thin -mx-2 divide-y divide-slate-100 dark:divide-slate-700/60">
                    {data.map((sale, index) => (
                        <div key={sale.invoice_number || index}
                             className="flex justify-between items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                    <User className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate leading-tight">{sale.customer_name || 'Unknown customer'}</p>
                                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{sale.invoice_number}</p>
                                </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                                <p className="tnum text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">₱{Number(sale.total_amount).toLocaleString()}</p>
                                <div className="flex items-center justify-end gap-1 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    <Clock className="h-2.5 w-2.5" />
                                    <span>{formatTimeAgo(sale.invoice_date)}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const LowStockAlertsPanel = ({ data = [], loading = false, onManageStock }) => {
    const { hasPermission } = useAuth();

    return (
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 h-[420px] flex flex-col shadow-card">
            <div className="flex justify-between items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning-500 dark:text-warning-400" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 tracking-tight">Stock alerts</h3>
                </div>
                {hasPermission('inventory:view') && onManageStock && (
                    <button
                        onClick={onManageStock}
                        className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 text-xs font-semibold flex items-center gap-1 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                        <span>Manage stock</span>
                        <ExternalLink className="h-3 w-3" />
                    </button>
                )}
            </div>

            {loading ? (
                <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center gap-3 px-2 py-2.5">
                            <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0"></div>
                            <div className="flex-1">
                                <div className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2"></div>
                                <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                            </div>
                            <div className="text-right">
                                <div className="h-3.5 bg-slate-200 dark:bg-slate-700 rounded w-16 mb-2 ml-auto"></div>
                                <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded w-12 ml-auto"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 flex-1 flex flex-col justify-center">
                    <CheckCircle2 className="h-9 w-9 mx-auto mb-3 text-success-500 dark:text-success-400" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Every part is above its minimum</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Nothing needs reordering right now.</p>
                </div>
            ) : (
                <div className="overflow-y-auto pr-1 flex-1 scrollbar-thin -mx-2 divide-y divide-slate-100 dark:divide-slate-700/60">
                    {data.map((item, index) => {
                        // Every row here is already below its minimum, so a uniform
                        // warning tint would carry no information. What actually
                        // separates these items is whether they can still be sold
                        // today, so that is what the row encodes.
                        const stock = Number(item.current_stock ?? item.stock ?? 0);
                        const minimum = item.warning_quantity ?? item.minimum;
                        const isOut = stock <= 0;

                        return (
                            <div key={item.part_id || index}
                                 className="flex justify-between items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer">
                                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        isOut
                                            ? 'bg-danger-50 dark:bg-danger-900/30 text-danger-600 dark:text-danger-400'
                                            : 'bg-warning-50 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400'
                                    }`}>
                                        <Package className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate leading-tight">{item.detail || item.name}</p>
                                        <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{item.internal_sku || item.part_code}</p>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    {/* Status is never carried by color alone - the label says it too. */}
                                    <p className={`text-xs font-semibold leading-tight ${
                                        isOut ? 'text-danger-600 dark:text-danger-400' : 'text-warning-600 dark:text-warning-400'
                                    }`}>
                                        {isOut ? 'Out of stock' : <span className="tnum">{stock} left</span>}
                                    </p>
                                    <p className="tnum text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Min {minimum}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const RecentActivityFeed = ({ recentSales, lowStockItems, loading, onViewAllSales, onManageStock }) => {
    const { hasPermission } = useAuth();

    const showSalesPanel = hasPermission('invoicing:create');
    const showStockPanel = hasPermission('inventory:view');

    if (!showSalesPanel && !showStockPanel) {
        return (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200/80 dark:border-slate-700 shadow-card">
                <div className="text-center py-8">
                    <FileText className="h-9 w-9 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">You don't have access to activity data</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Ask an administrator to grant sales or inventory access.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 ${showSalesPanel && showStockPanel ? 'lg:grid-cols-2' : ''} gap-4`}>
            {showSalesPanel && (
                <RecentSalesPanel
                    data={recentSales}
                    loading={loading}
                    onViewAll={onViewAllSales}
                />
            )}
            {showStockPanel && (
                <LowStockAlertsPanel
                    data={lowStockItems}
                    loading={loading}
                    onManageStock={onManageStock}
                />
            )}
        </div>
    );
};
