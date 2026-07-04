import React, { useState } from 'react';
import { Play, Search, RefreshCw } from 'lucide-react';
import StaffProgressTab from './StaffProgressTab';

const StaffDashboard = ({ tasks, onStart, onUnassignedFind, onRefresh }) => {
    const [activeTab, setActiveTab] = useState('tasks');
    const totalTasks = tasks.length;

    return (
        <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-900">My Cycle Count</h1>
                <button
                    onClick={onRefresh}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('tasks')}
                        className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                            activeTab === 'tasks'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        Pending Tasks
                        {totalTasks > 0 && (
                            <span className="ml-2 inline-block bg-blue-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                                {totalTasks}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('progress')}
                        className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                            activeTab === 'progress'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        My Progress
                    </button>
                </nav>
            </div>

            {activeTab === 'tasks' && (
                <>
                    {/* Today's batch */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                        <div className="p-6">
                            <h2 className="text-lg font-semibold text-gray-800 mb-3">Today's Batch</h2>
                            {totalTasks === 0 ? (
                                <div className="text-center py-10">
                                    <div className="text-5xl mb-3">✅</div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-1">All caught up!</h3>
                                    <p className="text-gray-500 text-sm">No pending cycle count tasks.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row justify-between items-center bg-blue-50 rounded-lg p-6 gap-4">
                                    <div className="text-center sm:text-left">
                                        <span className="block text-5xl font-bold text-blue-600 mb-1">{totalTasks}</span>
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

                    {/* Unassigned find */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-800 mb-1">Found something unexpected?</h2>
                                <p className="text-sm text-gray-500">Log items that are not in your assigned batch.</p>
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
                </>
            )}

            {activeTab === 'progress' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <StaffProgressTab />
                </div>
            )}
        </div>
    );
};

export default StaffDashboard;
