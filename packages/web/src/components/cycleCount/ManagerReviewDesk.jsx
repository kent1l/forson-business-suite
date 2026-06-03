import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import EmployeePerformanceTab from './EmployeePerformanceTab';

export default function ManagerReviewDesk() {
    const [activeTab, setActiveTab] = useState('pending_reviews');
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (activeTab === 'pending_reviews') {
            fetchPendingReviews();
        }
    }, [activeTab]);

    const fetchPendingReviews = async () => {
        setLoading(true);
        try {
            const response = await api.get('/inventory/cycle-count/manager/review');
            setLines(response.data);
        } catch (error) {
            console.error('Failed to fetch pending reviews', error);
            toast.error('Failed to load pending reviews.');
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (lineId) => {
        try {
            const response = await api.post(`/inventory/cycle-count/lines/${lineId}/approve`);
            toast.success('Adjustment approved successfully.');
            setLines(prev => prev.filter(line => line.line_id !== lineId));
        } catch (error) {
            console.error('Error approving adjustment', error);
            const errMsg = error.response?.data?.message || 'Failed to approve adjustment';
            toast.error(errMsg);
        }
    };

    return (
        <div className="manager-review-desk p-4">
            <h2 className="text-2xl font-bold mb-4">Manager Review Desk</h2>

            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('pending_reviews')}
                        className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'pending_reviews' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                    >
                        Pending Reviews
                    </button>
                    <button
                        onClick={() => setActiveTab('performance')}
                        className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'performance' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                    >
                        Employee Performance
                    </button>
                </nav>
            </div>

            {activeTab === 'pending_reviews' && (
                <div>
                    {loading ? (
                        <div>Loading pending reviews...</div>
                    ) : lines.length === 0 ? (
                        <p>No pending reviews.</p>
                    ) : (
                        <table className="min-w-full bg-white border border-gray-200">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="py-2 px-4 border-b text-left">Part Name</th>
                                    <th className="py-2 px-4 border-b text-left">SKU</th>
                                    <th className="py-2 px-4 border-b">Snapshot Qty</th>
                                    <th className="py-2 px-4 border-b">Physical Count</th>
                                    <th className="py-2 px-4 border-b">Variance</th>
                                    <th className="py-2 px-4 border-b">Financial Impact</th>
                                    <th className="py-2 px-4 border-b">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line) => {
                                    const varianceQty = parseFloat(line.variance_qty) || 0;
                                    const financialImpact = parseFloat(line.financial_impact) || 0;
                                    const isPositive = varianceQty > 0;
                                    const isNegative = varianceQty < 0;
                                    const colorClass = isNegative ? 'text-red-600' : isPositive ? 'text-green-600' : 'text-gray-900';

                                    return (
                                        <tr key={line.line_id} className="text-center hover:bg-gray-50">
                                            <td className="py-2 px-4 border-b text-left">{line.detail}</td>
                                            <td className="py-2 px-4 border-b text-left">{line.internal_sku}</td>
                                            <td className="py-2 px-4 border-b">{line.system_qty_snapshot}</td>
                                            <td className="py-2 px-4 border-b font-medium">{line.counted_qty}</td>
                                            <td className={`py-2 px-4 border-b font-bold ${colorClass}`}>
                                                {isPositive ? `+${varianceQty}` : varianceQty}
                                            </td>
                                            <td className={`py-2 px-4 border-b font-bold ${colorClass}`}>
                                                $${financialImpact.toFixed(2)}
                                            </td>
                                            <td className="py-2 px-4 border-b">
                                                <button
                                                    onClick={() => handleApprove(line.line_id)}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded shadow-sm transition-colors"
                                                >
                                                    Approve Adjustment
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {activeTab === 'performance' && (
                <EmployeePerformanceTab />
            )}
        </div>
    );
}
