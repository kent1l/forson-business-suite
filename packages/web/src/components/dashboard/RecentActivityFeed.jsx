import { Clock, User, FileText, AlertTriangle, Package, ExternalLink } from 'lucide-react';

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
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                    <FileText className="h-5 w-5 text-gray-600" />
                    <h3 className="text-lg font-semibold text-gray-800">Recent Sales</h3>
                </div>
                <button 
                    onClick={onViewAll}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1 transition-colors"
                >
                    <span>View All</span>
                    <ExternalLink className="h-3 w-3" />
                </button>
            </div>
            
            {loading ? (
                <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                            <div className="flex-1">
                                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                            </div>
                            <div className="text-right">
                                <div className="h-4 bg-gray-200 rounded w-16 mb-2"></div>
                                <div className="h-3 bg-gray-200 rounded w-12"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p>No recent sales found</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {data.map((sale, index) => (
                        <div key={sale.invoice_number || index} 
                             className="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                            <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                    <User className="h-4 w-4 text-gray-500" />
                                    <p className="font-medium text-gray-800">{sale.customer_name || 'Unknown Customer'}</p>
                                </div>
                                <p className="text-sm text-gray-600">Invoice #{sale.invoice_number}</p>
                            </div>
                            <div className="text-right">
                                <p className="font-semibold text-gray-900">₱{Number(sale.total_amount).toLocaleString()}</p>
                                <div className="flex items-center space-x-1 text-sm text-gray-500">
                                    <Clock className="h-3 w-3" />
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
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                    <h3 className="text-lg font-semibold text-gray-800">Stock Alerts</h3>
                </div>
                <button 
                    onClick={onManageStock}
                    className="text-orange-600 hover:text-orange-800 text-sm font-medium flex items-center space-x-1 transition-colors"
                >
                    <span>Manage Stock</span>
                    <ExternalLink className="h-3 w-3" />
                </button>
            </div>
            
            {loading ? (
                <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                            <div className="flex-1">
                                <div className="h-4 bg-orange-200 rounded w-3/4 mb-2"></div>
                                <div className="h-3 bg-orange-200 rounded w-1/2"></div>
                            </div>
                            <div className="text-right">
                                <div className="h-4 bg-orange-200 rounded w-16 mb-2"></div>
                                <div className="h-3 bg-orange-200 rounded w-12"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : data.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-3 text-green-300" />
                    <p>All stock levels are healthy</p>
                    <p className="text-sm text-gray-400 mt-1">No low stock alerts</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {data.map((item, index) => (
                        <div key={item.part_id || index} 
                             className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border-l-4 border-orange-400 hover:bg-orange-100 transition-colors cursor-pointer">
                            <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                    <Package className="h-4 w-4 text-orange-600" />
                                    <p className="font-medium text-gray-800">{item.detail || item.name}</p>
                                </div>
                                <p className="text-sm text-gray-600">{item.internal_sku || item.part_code}</p>
                            </div>
                            <div className="text-right">
                                <p className="font-semibold text-orange-600">{item.current_stock || item.stock} left</p>
                                <p className="text-sm text-gray-600">Min: {item.warning_quantity || item.minimum}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const RecentActivityFeed = ({ recentSales, lowStockItems, loading, onViewAllSales, onManageStock }) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RecentSalesPanel 
                data={recentSales} 
                loading={loading} 
                onViewAll={onViewAllSales}
            />
            <LowStockAlertsPanel 
                data={lowStockItems} 
                loading={loading} 
                onManageStock={onManageStock}
            />
        </div>
    );
};