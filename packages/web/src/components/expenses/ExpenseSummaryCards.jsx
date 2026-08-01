import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseSummaryCards({ categorySummary = [], monthlySummary = [] }) {
    const totalCurrentMonth = categorySummary.reduce((acc, c) => acc + (parseFloat(c.total_amount) || 0), 0);

    const formatCurrency = (amt) => {
        const val = parseFloat(amt) || 0;
        return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    return (
        <div className="space-y-6 mb-6">
            {/* Top Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Current Month Total Card */}
                <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Filtered Total Expenses</p>
                        <h3 className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalCurrentMonth)}</h3>
                        <p className="text-xs text-slate-400 mt-1">{categorySummary.reduce((a, b) => a + (b.count || 0), 0)} logged expenses</p>
                    </div>
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                        <Icon path={ICONS.receipt} className="w-7 h-7" />
                    </div>
                </div>

                {/* Top Category Card */}
                <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top Expense Category</p>
                        <h3 className="text-lg font-bold text-slate-900 mt-1 truncate max-w-[200px]">
                            {categorySummary[0]?.category_name || 'N/A'}
                        </h3>
                        <p className="text-xs text-blue-600 font-semibold mt-1">
                            {categorySummary[0] ? formatCurrency(categorySummary[0].total_amount) : '₱0.00'}
                        </p>
                    </div>
                    <div className="p-3 bg-purple-50 text-purple-600 rounded-xl border border-purple-100">
                        <Icon path={ICONS.tag} className="w-7 h-7" />
                    </div>
                </div>

                {/* Categories Count Card */}
                <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Categories</p>
                        <h3 className="text-2xl font-bold text-slate-900 mt-1">{categorySummary.length}</h3>
                        <p className="text-xs text-slate-400 mt-1">With logged expenses in period</p>
                    </div>
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                        <Icon path={ICONS.inventory} className="w-7 h-7" />
                    </div>
                </div>
            </div>

            {/* Charts & Category Breakdown Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Monthly Comparison Bar Chart */}
                <div className="lg:col-span-2 bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Monthly Expense Trend</h4>
                            <p className="text-xs text-slate-400">Month-over-month total operating expenses (Last 12 Months)</p>
                        </div>
                    </div>
                    <div className="h-64 w-full">
                        {monthlySummary.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-xs text-slate-400">
                                No monthly summary data available
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthlySummary} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="month_label" tick={{ fontSize: 11, fill: '#64748B' }} />
                                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => `₱${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                                    <Tooltip
                                        formatter={(value) => [`₱${parseFloat(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`, 'Total Expenses']}
                                        labelStyle={{ fontWeight: 'bold', color: '#1E293B' }}
                                        contentStyle={{ borderRadius: '8px', borderColor: '#E2E8F0', fontSize: '12px' }}
                                    />
                                    <Bar dataKey="total_amount" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Category Totals List */}
                <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                    <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-1">Expenses by Category</h4>
                    <p className="text-xs text-slate-400 mb-4">Breakdown of operating costs</p>

                    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {categorySummary.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-6">No category data in date range</p>
                        ) : (
                            categorySummary.map((cat, idx) => {
                                const pct = totalCurrentMonth > 0 ? (cat.total_amount / totalCurrentMonth) * 100 : 0;
                                return (
                                    <div key={cat.category_id || idx} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs font-medium">
                                            <span className="text-slate-700 font-semibold truncate max-w-[140px]">{cat.category_name}</span>
                                            <span className="text-slate-900 font-bold">{formatCurrency(cat.total_amount)}</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                                style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
