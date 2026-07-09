import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const DeduplicationSettings = () => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [triggering, setTriggering] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const response = await api.get('/parts/merge/worker-status');
            if (response.data.success) {
                setStatus(response.data);
            }
        } catch (err) {
            console.error('Error fetching worker status:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    // Poll if batch is currently running
    useEffect(() => {
        if (!status || !status.latestBatch || status.latestBatch.status !== 'running') {
            return;
        }
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, [status, fetchStatus]);

    const handleToggle = async () => {
        if (toggling || !status) return;
        setToggling(true);
        const nextEnabled = !status.enabled;
        try {
            const response = await api.post('/parts/merge/worker-toggle', { enabled: nextEnabled });
            if (response.data.success) {
                setStatus(prev => ({ ...prev, enabled: nextEnabled }));
                toast.success(`Deduplication background worker ${nextEnabled ? 'enabled' : 'disabled'}`);
            }
        } catch {
            toast.error('Failed to toggle worker setting.');
        } finally {
            setToggling(false);
        }
    };

    const handleTriggerScan = async () => {
        if (triggering || (status?.latestBatch && status.latestBatch.status === 'running')) return;
        setTriggering(true);
        try {
            const response = await api.post('/parts/merge/trigger-scan');
            if (response.data.success) {
                toast.success('Deduplication scan successfully triggered!');
                fetchStatus();
            } else {
                toast.error(response.data.message || 'Failed to trigger scan.');
            }
        } catch {
            toast.error('Failed to trigger deduplication scan.');
        } finally {
            setTriggering(false);
        }
    };

    if (loading) {
        return <div className="text-gray-500 text-sm">Loading deduplication status...</div>;
    }

    const { enabled, latestBatch, batchHistory = [], pendingSuggestions = {} } = status || {};
    const isRunning = latestBatch && latestBatch.status === 'running';

    // Calculate progress values
    const total = latestBatch?.total_clusters || 0;
    const processed = latestBatch?.processed_clusters || 0;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    const inQueue = Math.max(0, total - processed);

    return (
        <div className="space-y-6">
            {/* Background process switch card */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-start justify-between">
                <div className="space-y-1 pr-4">
                    <h3 className="text-sm font-semibold text-gray-900">Nightly Background Deduplication Scan</h3>
                    <p className="text-xs text-gray-500">
                        Automatically runs nightly to search the entire parts catalog using semantic blocking (Meilisearch) and AI-first group validation. Matches will be stored as suggestions.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleToggle}
                    disabled={toggling}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        enabled ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                >
                    <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                    />
                </button>
            </div>

            {/* Live scanning progress card */}
            {isRunning && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="flex h-2.5 w-2.5 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
                            </span>
                            <h3 className="text-sm font-semibold text-blue-900">Background Scan In Progress...</h3>
                        </div>
                        <span className="text-xs font-mono font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                            Batch #{latestBatch.batch_id}
                        </span>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-blue-800">
                            <span>Analyzing candidate duplicate clusters...</span>
                            <span className="font-semibold">{percent}% ({processed} / {total})</span>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full bg-blue-200 rounded-full h-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 text-center">
                        <div className="bg-white p-3 rounded-lg border border-blue-100">
                            <div className="text-xs text-gray-500">Processed</div>
                            <div className="text-lg font-bold text-blue-900 font-mono">{processed}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-blue-100">
                            <div className="text-xs text-gray-500">In Queue</div>
                            <div className="text-lg font-bold text-blue-900 font-mono">{inQueue}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-blue-100">
                            <div className="text-xs text-gray-500">AI Calls Made</div>
                            <div className="text-lg font-bold text-blue-900 font-mono">{latestBatch.ai_calls_made}</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg border border-blue-100">
                            <div className="text-xs text-gray-500">Groups Found</div>
                            <div className="text-lg font-bold text-blue-900 font-mono">{latestBatch.total_groups}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Inactive state trigger card */}
            {!isRunning && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900">Trigger On-Demand Scan</h3>
                        <p className="text-xs text-gray-500 mt-1">
                            Run the deduplication engine immediately to process the current parts database. This process runs asynchronously in the background.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleTriggerScan}
                        disabled={triggering}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {triggering ? 'Triggering...' : 'Start Manual Scan'}
                    </button>
                </div>
            )}

            {/* Pending suggestions summary */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Current Suggestions Queue</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                    <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
                        <div className="text-xs text-green-700 font-medium">Exact Matches</div>
                        <div className="text-xl font-bold text-green-955 font-mono mt-0.5">{pendingSuggestions.exact || 0}</div>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
                        <div className="text-xs text-blue-700 font-medium">AI Confirmed</div>
                        <div className="text-xl font-bold text-blue-955 font-mono mt-0.5">{pendingSuggestions.high || 0}</div>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
                        <div className="text-xs text-yellow-700 font-medium">AI Suggested</div>
                        <div className="text-xl font-bold text-yellow-955 font-mono mt-0.5">{pendingSuggestions.medium || 0}</div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg">
                        <div className="text-xs text-gray-600 font-medium">Low Confidence</div>
                        <div className="text-xl font-bold text-gray-955 font-mono mt-0.5">{pendingSuggestions.low || 0}</div>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-lg col-span-2 sm:col-span-1">
                        <div className="text-xs text-indigo-700 font-medium">Total Pending</div>
                        <div className="text-xl font-bold text-indigo-955 font-mono mt-0.5">{pendingSuggestions.total || 0}</div>
                    </div>
                </div>
            </div>

            {/* Scan batch history */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Recent Scan Runs</h3>
                {batchHistory.length === 0 ? (
                    <p className="text-xs text-gray-500">No scan history recorded.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100 text-gray-500 font-medium">
                                    <th className="py-2 pr-4">Batch ID</th>
                                    <th className="py-2 pr-4">Started At</th>
                                    <th className="py-2 pr-4">Duration</th>
                                    <th className="py-2 pr-4">Status</th>
                                    <th className="py-2 pr-4">AI Calls</th>
                                    <th className="py-2">Groups Found</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-gray-700">
                                {batchHistory.map(b => {
                                    const durationSec = b.completed_at ? Math.round((new Date(b.completed_at) - new Date(b.started_at)) / 1000) : 0;
                                    const minutes = Math.floor(durationSec / 60);
                                    const seconds = durationSec % 60;
                                    const durationStr = b.completed_at ? `${minutes}m ${seconds}s` : '—';
                                    return (
                                        <tr key={b.batch_id} className="hover:bg-gray-50">
                                            <td className="py-2.5 font-mono text-gray-900">#{b.batch_id}</td>
                                            <td className="py-2.5 pr-4 text-gray-500">
                                                {new Date(b.started_at).toLocaleString()}
                                            </td>
                                            <td className="py-2.5 pr-4">{durationStr}</td>
                                            <td className="py-2.5 pr-4">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                    b.status === 'complete' ? 'bg-green-100 text-green-800' :
                                                    b.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                    b.status === 'running' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                                                    'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {b.status.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-4 font-mono">{b.ai_calls_made}</td>
                                            <td className="py-2.5 font-semibold text-gray-900">{b.total_groups}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeduplicationSettings;
