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
import { Calendar } from 'lucide-react';

const CustomTooltip = ({ active, payload, label, formatter }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
                <p className="text-sm text-gray-600 mb-1">{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} className="text-sm font-medium" style={{ color: entry.color }}>
                        {formatter ? formatter(entry.value, entry.name) : `${entry.name}: ${entry.value}`}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

export const SalesTrendChart = ({ data, loading, timeRange, onTimeRangeChange }) => {
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200 h-80 flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-800">Sales Trend</h3>
                <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <select 
                        value={timeRange} 
                        onChange={(e) => onTimeRangeChange && onTimeRangeChange(e.target.value)}
                        className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="30">Last 30 Days</option>
                        <option value="90">Last 90 Days</option>
                        <option value="365">This Year</option>
                    </select>
                </div>
            </div>
            
            {loading ? (
                <div className="flex-1 bg-gray-100 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400">Loading chart data...</div>
                </div>
            ) : (
                <div className="flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis 
                                dataKey="date" 
                                fontSize={12} 
                                tickLine={false} 
                                axisLine={false}
                                tick={{ fill: '#64748b' }}
                            />
                            <YAxis 
                                fontSize={12} 
                                tickLine={false} 
                                axisLine={false}
                                tick={{ fill: '#64748b' }}
                                tickFormatter={(value) => `₱${(value/1000).toFixed(0)}K`}
                            />
                            <Tooltip 
                                content={(props) => CustomTooltip({...props, formatter: (value) => [`₱${Number(value).toLocaleString()}`, "Sales"]})}
                            />
                            <Line 
                                type="monotone" 
                                dataKey="total_sales" 
                                stroke="#3b82f6" 
                                strokeWidth={3}
                                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                                activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};

export const TopProductsChart = ({ data, loading }) => {
    // Filter out any items with zero or null revenue and sort by revenue descending
    const validData = data?.filter(item => item.total_revenue > 0)
        .sort((a, b) => b.total_revenue - a.total_revenue) || [];
    
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200 h-80 flex flex-col">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-800">Top Selling Products</h3>
                <span className="text-sm text-gray-500">Last 30 Days</span>
            </div>
            
            {loading ? (
                <div className="flex-1 space-y-3 overflow-hidden">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="animate-pulse flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center space-x-3">
                                <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
                                <div className="w-32 h-4 bg-gray-200 rounded"></div>
                            </div>
                            <div className="flex space-x-6 text-right">
                                <div className="w-12 h-4 bg-gray-200 rounded"></div>
                                <div className="w-16 h-4 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : validData.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                    <div className="text-center">
                        <div className="text-4xl mb-2">📊</div>
                        <p className="font-medium">No sales data</p>
                        <p className="text-sm">Top products will appear here</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col min-h-0">
                    {/* Header */}
                    <div className="flex justify-between items-center px-3 py-2 bg-gray-50 rounded-lg text-sm font-medium text-gray-600 flex-shrink-0 mb-2">
                        <div className="flex items-center space-x-3 flex-1">
                            <span className="w-6 text-center">#</span>
                            <span>Product</span>
                        </div>
                        <div className="flex space-x-4 text-right">
                            <span className="w-12">Sold</span>
                            <span className="w-20">Revenue</span>
                        </div>
                    </div>
                    
                    {/* Scrollable Product List */}
                    <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                        {validData.map((product, index) => (
                            <div key={index} className="flex justify-between items-center px-3 py-2.5 bg-white border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                        index === 0 ? 'bg-yellow-100 text-yellow-800' :
                                        index === 1 ? 'bg-gray-100 text-gray-800' :
                                        index === 2 ? 'bg-orange-100 text-orange-800' :
                                        'bg-blue-100 text-blue-800'
                                    }`}>
                                        {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-gray-900 truncate" title={product.product_name}>
                                            {product.product_name}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex space-x-4 text-right flex-shrink-0">
                                    <span className="w-12 text-xs text-gray-600">
                                        {parseFloat(product.total_quantity).toFixed(0)}
                                    </span>
                                    <span className="w-20 text-xs font-semibold text-gray-900">
                                        ₱{Number(product.total_revenue).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export const InventoryChart = ({ data, loading }) => {
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Inventory Distribution</h3>
                <span className="text-sm text-gray-500">By Category</span>
            </div>
            
            {loading ? (
                <div className="h-80 bg-gray-100 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400">Loading inventory...</div>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis 
                            dataKey="category" 
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#64748b' }}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                        />
                        <YAxis 
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#64748b' }}
                        />
                        <Tooltip 
                            content={(props) => CustomTooltip({...props, formatter: (value, name) => {
                                if (name === 'value') return [`₱${Number(value).toLocaleString()}`, "Value"];
                                if (name === 'quantity') return [`${value} items`, "Quantity"];
                                return [value, name];
                            }})}
                        />
                        <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
};