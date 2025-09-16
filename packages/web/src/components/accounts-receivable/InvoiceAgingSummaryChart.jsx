import { exportToCSV } from '../../utils/csv';
import { formatCurrency } from '../../utils/currency';

// Invoice Aging Summary Chart Component
const InvoiceAgingSummaryChart = ({ agingData, loading = false, onBucketClick }) => {
    if (loading) {
        return (
            <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
                <div className="w-full bg-gray-200 rounded-full h-8 mb-4"></div>
                <div className="flex justify-between">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="flex items-center gap-x-2">
                            <div className="w-3 h-3 rounded-full bg-gray-200"></div>
                            <div className="h-3 bg-gray-200 rounded w-16"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const total = agingData.reduce((sum, item) => sum + item.value, 0);

    // Use colors that match the existing design system (consistent with Dashboard.jsx)
    const colors = {
        'Current': 'bg-blue-500',
        '1-30 Days': 'bg-blue-400',
        '31-60 Days': 'bg-yellow-400',
        '61-90 Days': 'bg-orange-400',
        '90+ Days': 'bg-red-500',
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Invoice Aging Summary</h2>
                <button
                    onClick={() => exportToCSV(agingData, 'invoice-aging-summary.csv')}
                    className="text-sm px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    Export
                </button>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-8 flex overflow-hidden">
                {agingData.map(item => (
                    <div
                        key={item.name}
                        className={`h-full ${colors[item.name]} transition-all duration-300 ease-in-out hover:opacity-80 cursor-pointer`}
                        style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
                        title={`${item.name}: ${formatCurrency(item.value)} (${total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}%) - Click to view details`}
                        onClick={() => onBucketClick && onBucketClick(item.name)}
                    ></div>
                ))}
            </div>
            <div className="flex justify-between text-sm text-gray-600 mt-4 flex-wrap gap-2">
                {agingData.map(item => (
                    <div key={item.name} className="flex items-center gap-x-2">
                        <span className={`w-3 h-3 rounded-full ${colors[item.name]}`}></span>
                        <span className="whitespace-nowrap">{item.name}: {formatCurrency(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default InvoiceAgingSummaryChart;