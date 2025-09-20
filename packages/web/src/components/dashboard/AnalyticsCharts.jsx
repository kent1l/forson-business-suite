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
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
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
                <div className="h-80 bg-gray-100 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400">Loading chart data...</div>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={320}>
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
            )}
        </div>
    );
};

export const TopProductsChart = ({ data, loading }) => {
    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Top Selling Products</h3>
                <span className="text-sm text-gray-500">Last 30 Days</span>
            </div>
            
            {loading ? (
                <div className="h-80 bg-gray-100 rounded animate-pulse flex items-center justify-center">
                    <div className="text-gray-400">Loading products...</div>
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={320}>
                    <BarChart 
                        data={data} 
                        layout="horizontal" 
                        margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis 
                            type="number" 
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#64748b' }}
                            tickFormatter={(value) => `₱${(value/1000).toFixed(0)}K`}
                        />
                        <YAxis 
                            dataKey="product_name" 
                            type="category" 
                            width={100}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: '#64748b' }}
                        />
                        <Tooltip 
                            content={(props) => CustomTooltip({...props, formatter: (value, name) => {
                                if (name === 'total_revenue') return [`₱${Number(value).toLocaleString()}`, "Revenue"];
                                if (name === 'total_quantity') return [`${value} units`, "Sold"];
                                return [value, name];
                            }})}
                        />
                        <Bar 
                            dataKey="total_revenue" 
                            fill="#10b981" 
                            radius={[0, 4, 4, 0]}
                        />
                    </BarChart>
                </ResponsiveContainer>
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