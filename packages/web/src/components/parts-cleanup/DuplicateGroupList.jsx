import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const DuplicateGroupList = ({ selectedGroups, onSelectionChange, similarityThreshold }) => {
    const [duplicateGroups, setDuplicateGroups] = useState([]);
    const [aiStats, setAiStats] = useState(null);
    const [progress, setProgress] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isCompact, setIsCompact] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedGroups, setExpandedGroups] = useState({});
    const [latestBatch, setLatestBatch] = useState(null);
    const [counts, setCounts] = useState({});
    const [triggeringRefresh, setTriggeringRefresh] = useState(false);

    const fetchDuplicateGroups = useCallback(async () => {
        setLoading(true);
        setError(null);
        setProgress(null);

        try {
            // Read from pre-computed suggestions table — instant, no computation
            const params = new URLSearchParams({ limit: 200 });
            if (similarityThreshold >= 0.9) params.set('confidence', 'exact');
            else if (similarityThreshold >= 0.8) params.set('confidence', 'high');
            // medium/low: no filter, show all

            const response = await api.get(`/parts/merge/suggestions?${params}`);
            setDuplicateGroups(response.data.groups || []);
            setLatestBatch(response.data.latestBatch || null);
            setCounts(response.data.counts || {});
        } catch (err) {
            console.error('Error fetching suggestions:', err);
            setError('Failed to load duplicate suggestions. Please try again.');
            toast.error('Failed to load duplicate suggestions');
        } finally {
            setLoading(false);
        }
    }, [similarityThreshold]);

    const triggerRefreshScan = async () => {
        setTriggeringRefresh(true);
        try {
            const response = await api.post('/parts/merge/trigger-scan');
            if (response.data.success) {
                toast.success('Deduplication scan started! Results will update when complete.');
            } else {
                toast.error(response.data.message || 'Could not start scan.');
            }
        } catch {
            toast.error('Failed to trigger scan.');
        } finally {
            setTriggeringRefresh(false);
        }
    };

    useEffect(() => {
        fetchDuplicateGroups();
    }, [fetchDuplicateGroups]);

    // Refresh when other parts of the app notify that parts were created/updated
    useEffect(() => {
        const handler = () => {
            // Optional: allow event detail to include a boolean to force refresh
            fetchDuplicateGroups();
        };

        window.addEventListener('parts:created', handler);
        window.addEventListener('parts:updated', handler);

        return () => {
            window.removeEventListener('parts:created', handler);
            window.removeEventListener('parts:updated', handler);
        };
    }, [fetchDuplicateGroups]);

    const handleGroupSelection = (group, isSelected) => {
        const newSelection = isSelected 
            ? [...selectedGroups, group]
            : selectedGroups.filter(g => g.groupId !== group.groupId);
        
        onSelectionChange(newSelection);
    };

    const isGroupSelected = (groupId) => {
        return selectedGroups.some(g => g.groupId === groupId);
    };

    const toggleGroupExpansion = (groupId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    };

    const excludeGroup = async (group) => {
        try {
            if (group.suggestionId) {
                // New suggestion-based dismiss
                await api.post(`/parts/merge/suggestions/${group.suggestionId}/dismiss`);
            } else if (group.parts.length >= 2) {
                // Legacy fallback for groups not from suggestion table
                await api.post('/parts/merge/exclude', {
                    partId1: group.parts[0].part_id,
                    partId2: group.parts[1].part_id
                });
            }
            toast.success('Group dismissed. Parts excluded from future scans.');
            setDuplicateGroups(prev => prev.filter(g => g.groupId !== group.groupId));
            onSelectionChange(selectedGroups.filter(g => g.groupId !== group.groupId));
        } catch {
            toast.error('Failed to dismiss group.');
        }
    };

    const renderConfidenceBadge = (group) => {
        const tier = group.confidenceTier || 'low';
        const configs = {
            exact:  { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-300',  label: '🟢 Exact Match',     desc: 'Identical normalized part number' },
            high:   { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-300',   label: '🔵 AI Confirmed',    desc: 'AI verified with high confidence' },
            medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300', label: '🟡 AI Suggested',    desc: 'AI suggested, review recommended' },
            low:    { bg: 'bg-gray-100',   text: 'text-gray-700',   border: 'border-gray-300',   label: '⚪ Low Confidence',  desc: 'Weak signal — inspect carefully' },
        };
        const c = configs[tier] || configs.low;
        return (
            <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}
                title={c.desc}
            >
                {c.label}
            </span>
        );
    };

    const filteredGroups = duplicateGroups.filter(group => {
        if (!searchTerm) return true;
        
        return group.parts.some(part => 
            part.display_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            part.internal_sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            part.part_numbers?.some(pn => 
                pn.part_number?.toLowerCase().includes(searchTerm.toLowerCase())
            )
        );
    });

    const formatPartNumber = (partNumbers) => {
        if (!partNumbers || !Array.isArray(partNumbers)) return 'N/A';
        return partNumbers.slice(0, 2).map(pn => pn.part_number || pn).join(', ') + 
               (partNumbers.length > 2 ? ` +${partNumbers.length - 2} more` : '');
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-200 rounded-lg shadow-sm">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Loading Suggestions</h3>
                <span className="text-sm text-gray-600 mb-6 font-medium">
                    Reading pre-computed duplicate groups...
                </span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                    <Icon path={ICONS.warning} className="h-5 w-5 text-red-600 mr-2" />
                    <h3 className="text-sm font-medium text-red-800">Error Loading Duplicates</h3>
                </div>
                <p className="text-sm text-red-700 mt-1">{error}</p>
                <button
                    onClick={fetchDuplicateGroups}
                    className="mt-3 text-sm text-red-700 hover:text-red-900 underline"
                >
                    Try again
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Controls */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Search Parts
                        </label>
                        <div className="relative">
                            <Icon 
                                path={ICONS.search} 
                                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                            />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search by name, SKU, or part number..."
                                className="pl-10 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                    </div>
                    
                    <div className="w-full sm:w-auto flex items-end space-x-2 flex-wrap gap-y-2">
                        <button
                            onClick={() => {
                                if (selectedGroups.length === filteredGroups.length && filteredGroups.length > 0) {
                                    onSelectionChange([]);
                                } else {
                                    onSelectionChange([...filteredGroups]);
                                }
                            }}
                            className="inline-flex items-center px-3 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium shadow-sm transition-colors"
                        >
                            {selectedGroups.length === filteredGroups.length && filteredGroups.length > 0 ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                            onClick={() => {
                                const aiVerifiedGroups = duplicateGroups.filter(g =>
                                    g.confidenceTier === 'high' || g.confidenceTier === 'medium' || g.confidenceTier === 'low'
                                );
                                onSelectionChange(aiVerifiedGroups);
                                toast.success(`Selected ${aiVerifiedGroups.length} AI-verified groups`);
                            }}
                            title="Quickly select all duplicates that were verified by AI"
                            className="inline-flex items-center px-3 py-2 bg-gradient-to-r from-yellow-100 to-yellow-200 text-yellow-800 border border-yellow-300 rounded-lg hover:from-yellow-200 hover:to-yellow-300 text-sm font-medium shadow-sm transition-all"
                        >
                            🤖 AI-Verified Only
                        </button>
                        <button
                            onClick={() => {
                                const highConfidenceGroups = duplicateGroups.filter(g =>
                                    g.confidenceTier === 'exact' || g.confidenceTier === 'high'
                                );
                                onSelectionChange(highConfidenceGroups);
                                toast.success(`Selected ${highConfidenceGroups.length} high-confidence groups`);
                            }}
                            title="Quickly select all duplicates with High or Exact confidence"
                            className="inline-flex items-center px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 text-sm font-medium shadow-sm transition-colors"
                        >
                            ✓ Select High Confidence
                        </button>
                        <button
                            onClick={fetchDuplicateGroups}
                            title="Refresh duplicate groups"
                            className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm shadow-sm transition-colors"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Summary + Batch Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h3 className="text-sm font-medium text-blue-900">
                            {filteredGroups.length} suggestion{filteredGroups.length !== 1 ? 's' : ''} found
                            {selectedGroups.length > 0 && ` (${selectedGroups.length} selected)`}
                        </h3>
                        <div className="flex gap-3 mt-1 text-xs text-gray-600 flex-wrap">
                            {counts.exact > 0 && <span className="text-green-700 font-medium">🟢 {counts.exact} Exact</span>}
                            {counts.high > 0 && <span className="text-blue-700 font-medium">🔵 {counts.high} High</span>}
                            {counts.medium > 0 && <span className="text-yellow-700 font-medium">🟡 {counts.medium} Medium</span>}
                            {counts.low > 0 && <span className="text-gray-600">⚪ {counts.low} Low</span>}
                        </div>
                        {latestBatch && (
                            <div className="mt-1 text-xs text-gray-500">
                                Last scan: {new Date(latestBatch.completed_at || latestBatch.started_at).toLocaleString()}
                                {latestBatch.status === 'running' && ' (scan in progress...)'}
                                {latestBatch.status === 'failed' && ` — failed: ${latestBatch.error_message}`}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={triggerRefreshScan}
                            disabled={triggeringRefresh || latestBatch?.status === 'running'}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                            title="Trigger a new background scan. Results appear when complete."
                        >
                            {triggeringRefresh ? 'Starting...' : '🔄 Refresh Scan'}
                        </button>
                        <label className="flex items-center cursor-pointer ml-2">
                            <input
                                type="checkbox"
                                checked={isCompact}
                                onChange={(e) => setIsCompact(e.target.checked)}
                                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            Compact View
                        </label>
                    </div>
                </div>
            </div>

            {/* Duplicate Groups List */}
            {filteredGroups.length === 0 ? (
                <div className="text-center py-8">
                    <Icon path={ICONS.check} className="h-12 w-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Duplicates Found</h3>
                    <p className="text-gray-600">
                        {searchTerm 
                            ? 'No duplicate groups match your search criteria.'
                            : 'Great! No duplicate parts found with the current similarity threshold.'
                        }
                    </p>
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="mt-3 text-blue-600 hover:text-blue-700 underline"
                        >
                            Clear search
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {filteredGroups.map(group => {
                        const isSelected = selectedGroups.some(g => g.groupId === group.groupId);
                        const isExpanded = expandedGroups[group.groupId];
                        
                        if (isCompact) {
                            return (
                                <div 
                                    key={group.groupId} 
                                    onClick={() => handleGroupSelection(group, !isSelected)}
                                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                                        isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => {}}
                                            className="h-4 w-4 text-blue-600 rounded border-gray-300"
                                        />
                                        <div className="flex items-center w-32">
                                            {renderConfidenceBadge(group)}
                                        </div>
                                        <div className="text-sm text-gray-600 flex-1 truncate">
                                            {group.parts.map(p => p.display_name || p.internal_sku).join(' ⚡ ')}
                                        </div>
                                        <div className="flex gap-2">
                                            {group.reasons.map((r, i) => (
                                                <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                                                    {r.replace('_', ' ')}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={group.groupId}
                                className={`
                                    border rounded-lg transition-all duration-200
                                    ${isSelected 
                                        ? 'border-blue-500 bg-blue-50' 
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                    }
                                `}
                            >
                                <div className="p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start space-x-3">
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => handleGroupSelection(group, e.target.checked)}
                                                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                            />
                                            <div className="flex-1">
                                                <div className="flex flex-col mb-2">
                                                    <h3 className="text-sm font-medium text-gray-900 mb-1 flex items-center gap-2">
                                                        {renderConfidenceBadge(group)}
                                                        {group.ai_reasons?.length > 0 && (
                                                            <span className="text-xs text-gray-500 font-normal italic">
                                                                {group.ai_reasons[0]}
                                                            </span>
                                                        )}
                                                    </h3>
                                                </div>
                                                
                                                <div className="text-sm text-gray-600 mb-2">
                                                    {group.parts.length} parts • 
                                                    Will merge {group.parts.length - 1} part{group.parts.length - 1 !== 1 ? 's' : ''} into 1
                                                </div>

                                                {/* Quick preview of parts */}
                                                <div className="space-y-1">
                                                    {group.parts.slice(0, expandedGroups[group.groupId] ? undefined : 2).map((part) => (
                                                        <div key={part.part_id} className="text-xs text-gray-700">
                                                            <span className="font-mono">{part.internal_sku}</span> - 
                                                            <span className="ml-1">{part.display_name || 'Unnamed Part'}</span>
                                                            {part.part_numbers && (
                                                                <span className="ml-2 text-blue-600">
                                                                    ({formatPartNumber(part.part_numbers)})
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))}
                                                    
                                                    {!expandedGroups[group.groupId] && group.parts.length > 2 && (
                                                        <div className="text-xs text-gray-500">
                                                            +{group.parts.length - 2} more part{group.parts.length - 2 !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center space-x-3 ml-4">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    excludeGroup(group);
                                                }}
                                                className="text-xs px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-md transition-colors font-medium"
                                                title="Mark as NOT duplicates to exclude from future scans"
                                            >
                                                ⛔ Exclude
                                            </button>
                                            <button
                                                onClick={() => toggleGroupExpansion(group.groupId)}
                                                className="text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 p-1 rounded-full transition-colors"
                                            >
                                                <Icon 
                                                    path={isExpanded ? ICONS.chevronUp : ICONS.chevronDown} 
                                                    className="h-5 w-5" 
                                                />
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="mt-4 pt-4 border-t border-gray-200">
                                            {group.ai_reasons && group.ai_reasons.length > 0 && (
                                                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 shadow-sm">
                                                    <strong className="flex items-center gap-1 mb-1">🤖 AI Assessment Note:</strong>
                                                    <ul className="list-disc pl-5 space-y-1">
                                                        {group.ai_reasons.map((reason, idx) => (
                                                            <li key={idx} className="italic text-xs">{reason}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                {group.parts.map((part) => (
                                                    <div
                                                        key={part.part_id}
                                                        className="bg-gray-50 rounded-lg p-3 text-xs"
                                                    >
                                                        <div className="font-medium text-gray-900 mb-1">
                                                            {part.display_name || 'Unnamed Part'}
                                                        </div>
                                                        <div className="space-y-1 text-gray-600">
                                                            <div><strong>SKU:</strong> {part.internal_sku}</div>
                                                            {part.brand_name && (
                                                                <div><strong>Brand:</strong> {part.brand_name}</div>
                                                            )}
                                                            {part.part_numbers && part.part_numbers.length > 0 && (
                                                                <div>
                                                                    <strong>Part Numbers:</strong> {formatPartNumber(part.part_numbers)}
                                                                </div>
                                                            )}
                                                            {(part.cost_price || part.sale_price) && (
                                                                <div>
                                                                    <strong>Price:</strong> 
                                                                    {part.cost_price && ` Cost: ₱${parseFloat(part.cost_price).toFixed(2)}`}
                                                                    {part.sale_price && ` Sale: ₱${parseFloat(part.sale_price).toFixed(2)}`}
                                                                </div>
                                                            )}
                                                            <div className="text-xs text-gray-500 mt-2">
                                                                ID: {part.part_id}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default DuplicateGroupList;
