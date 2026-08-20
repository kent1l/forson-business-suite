import React, { useState } from 'react';
import { Play, Search, RefreshCw } from 'lucide-react';
import StaffProgressTab from './StaffProgressTab';
import InfoTip from '../ui/InfoTip';

const StaffDashboard = ({ tasks, onStart, onUnassignedFind, onRefresh }) => {
    const [activeTab, setActiveTab] = useState('tasks');
    const totalTasks = tasks.length;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">My Cycle Count</h1>
                <button
                    onClick={onRefresh}
                    className="p-2 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
                    title="Refresh"
                >
                    <RefreshCw className="w-5 h-5" />
                </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 dark:border-slate-700">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('tasks')}
                        className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
                            activeTab === 'tasks'
                                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600'
                        }`}
                    >
                        Pending Tasks
                        {totalTasks > 0 && (
                            <span className="ml-2 inline-block bg-primary-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                                {totalTasks}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('progress')}
                        className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer ${
                            activeTab === 'progress'
                                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600'
                        }`}
                    >
                        My Progress
                    </button>
                </nav>
            </div>

            {activeTab === 'tasks' && (
                <>
                    {/* Today's batch */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
                        <div className="p-6">
                            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-3 flex items-center gap-1">
                                Today's Batch
                                <InfoTip label="Cycle Count">
                                    A scheduled physical stock count. Enter the number you physically counted,
                                    not an estimate — getting this wrong can trigger incorrect stock corrections.
                                </InfoTip>
                            </h2>
                            {totalTasks === 0 ? (
                                <div className="text-center py-10">
                                    <div className="text-5xl mb-3">✅</div>
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100 mb-1">All caught up!</h3>
                                    <p className="text-gray-500 dark:text-slate-400 text-sm">No pending cycle count tasks.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row justify-between items-center bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-900/40 rounded-xl p-6 gap-4">
                                    <div className="text-center sm:text-left">
                                        <span className="block text-5xl font-bold text-primary-600 dark:text-primary-400 mb-1">{totalTasks}</span>
                                        <span className="text-sm font-medium text-primary-800 dark:text-primary-300 uppercase tracking-wide">Items to count</span>
                                    </div>
                                    <button
                                        onClick={onStart}
                                        className="flex items-center space-x-2 bg-primary-600 hover:bg-primary-700 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-md transition-colors w-full sm:w-auto justify-center cursor-pointer"
                                    >
                                        <Play className="w-6 h-6" />
                                        <span>Start Counting</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Unassigned find */}
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-1 flex items-center gap-1">
                                    Found something unexpected?
                                    <InfoTip label="Unassigned Find">
                                        If you count something that wasn't in your assigned batch, log it here
                                        instead of forcing it into a current item — search by barcode, name, or
                                        SKU, then enter the counted quantity.
                                    </InfoTip>
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Log items that are not in your assigned batch.</p>
                            </div>
                            <button
                                onClick={onUnassignedFind}
                                className="flex items-center space-x-2 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 px-6 py-3 rounded-lg font-medium transition-colors w-full sm:w-auto justify-center border border-gray-300 dark:border-slate-600 cursor-pointer"
                            >
                                <Search className="w-5 h-5 text-gray-500 dark:text-slate-400" />
                                <span>Log Unassigned Find</span>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'progress' && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
                    <StaffProgressTab />
                </div>
            )}
        </div>
    );
};

export default StaffDashboard;
