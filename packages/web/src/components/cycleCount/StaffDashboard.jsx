import React from 'react';
import { Play, Search, RefreshCw, CheckCircle } from 'lucide-react';

const StaffDashboard = ({ tasks, onStart, onUnassignedFind, onRefresh }) => {
    const totalTasks = tasks.length;

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900">My Cycle Count Tasks</h1>
                <button
                    onClick={onRefresh}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                    title="Refresh Tasks"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-8">
                <div className="p-6">
                    <h2 className="text-lg font-semibold text-gray-800 mb-2">Today's Batch</h2>
                    {totalTasks === 0 ? (
                        <div className="text-center py-12">
                            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <h3 className="text-xl font-medium text-gray-900 mb-2">All caught up!</h3>
                            <p className="text-gray-500">You have no pending cycle count tasks for today.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row justify-between items-center bg-blue-50 rounded-lg p-6">
                            <div className="mb-4 sm:mb-0 text-center sm:text-left">
                                <span className="block text-4xl font-bold text-blue-600 mb-1">{totalTasks}</span>
                                <span className="text-sm font-medium text-blue-800 uppercase tracking-wide">Items to count</span>
                            </div>
                            <button
                                onClick={onStart}
                                className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-lg font-bold text-lg shadow-md transition-colors w-full sm:w-auto justify-center"
                            >
                                <Play className="w-6 h-6" />
                                <span>Start Counting</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-800 mb-1">Found something unexpected?</h2>
                        <p className="text-sm text-gray-500 mb-4 sm:mb-0">Log items that are not in your assigned batch.</p>
                    </div>
                    <button
                        onClick={onUnassignedFind}
                        className="flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-medium transition-colors w-full sm:w-auto justify-center border border-gray-300"
                    >
                        <Search className="w-5 h-5 text-gray-500" />
                        <span>Log Unassigned Find</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StaffDashboard;
