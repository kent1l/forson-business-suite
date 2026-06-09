import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

export default function EmployeePerformanceTab() {
    const [performanceData, setPerformanceData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchPerformance = async () => {
        setLoading(true);
        try {
            const response = await api.get('/inventory/cycle-count/performance');
            setPerformanceData(response.data);
        } catch (error) {
            console.error('Failed to fetch employee performance', error);
            toast.error('Failed to load performance metrics.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPerformance();
    }, []);

    return (
        <div className="employee-performance-tab p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Employee Performance</h2>
                <button
                    onClick={fetchPerformance}
                    disabled={loading}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded shadow-sm transition-colors"
                >
                    {loading ? 'Refreshing...' : 'Refresh Data'}
                </button>
            </div>

            {loading ? (
                <div>Loading performance data...</div>
            ) : performanceData.length === 0 ? (
                <p>No performance data available.</p>
            ) : (
                <table className="min-w-full bg-white border border-gray-200">
                    <thead className="bg-gray-100">
                        <tr>
                            <th className="py-2 px-4 border-b text-left">Employee Name</th>
                            <th className="py-2 px-4 border-b">Average Completion Speed (mins)</th>
                            <th className="py-2 px-4 border-b">Match Accuracy %</th>
                            <th className="py-2 px-4 border-b">Discovery Volume</th>
                        </tr>
                    </thead>
                    <tbody>
                        {performanceData.map((data) => (
                            <tr key={data.employee_id} className="text-center hover:bg-gray-50">
                                <td className="py-2 px-4 border-b text-left font-medium">{data.employee_name}</td>
                                <td className="py-2 px-4 border-b">{parseFloat(data.avg_speed_mins).toFixed(1)}</td>
                                <td className="py-2 px-4 border-b">{parseFloat(data.match_accuracy_percent).toFixed(1)}%</td>
                                <td className="py-2 px-4 border-b">{data.discovery_volume}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
