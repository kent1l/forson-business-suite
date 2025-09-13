import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const DuplicateGroupList = ({ selectedGroups, onSelectionChange }) => {
    const [duplicateGroups, setDuplicateGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [similarityThreshold, setSimilarityThreshold] = useState(0.8);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [useOptimized, setUseOptimized] = useState(false);

    const fetchDuplicateGroups = useCallback(async () => {
        setLoading(true);
        setError(null);
        
        try {
            const params = {
                excludeMerged: true
            };
            if (useOptimized) {
                params.algo = 'v2';
                params.minScore = similarityThreshold;
            } else {
                params.minSimilarity = similarityThreshold;
            }
            const response = await api.get('/parts/merge/duplicates', { params });
            
            setDuplicateGroups(response.data.groups || []);
        } catch (err) {
            console.error('Error fetching duplicate groups:', err);
            setError('Failed to fetch duplicate groups. Please try again.');
            toast.error('Failed to load duplicate groups');
        } finally {
            setLoading(false);
        }
    }, [similarityThreshold, useOptimized]);

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
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600">Finding duplicate parts...</span>
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
                    
                    <div className="w-full sm:w-48 flex items-end gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Similarity Threshold
                            </label>
                            <select
                                value={similarityThreshold}
                                onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value={0.9}>Very High (90%)</option>
                                <option value={0.8}>High (80%)</option>
                                <option value={0.7}>Medium (70%)</option>
                                <option value={0.6}>Low (60%)</option>
                            </select>
                        </div>

                        <div className="flex flex-col items-start">
                            <label className="flex items-center text-sm">
                                <input
                                    type="checkbox"
                                    checked={useOptimized}
                                    onChange={(e) => setUseOptimized(e.target.checked)}
                                    className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                />
                                Optimized Algorithm
                            </label>
                        </div>

                        <button
                            onClick={fetchDuplicateGroups}
                            title="Refresh duplicate groups"
                            className="ml-2 inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-blue-900">
                            Found {filteredGroups.length} duplicate group{filteredGroups.length !== 1 ? 's' : ''}
                        </h3>
                        <p className="text-sm text-blue-700">
                            {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''} selected for merge
                        </p>
                    </div>
                    {selectedGroups.length > 0 && (
                        <div className="text-sm text-blue-700">
                            Total parts to merge: {selectedGroups.reduce((sum, g) => sum + g.parts.length - 1, 0)}
                        </div>
                    )}
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
                    {filteredGroups.map((group) => {
                        const isSelected = isGroupSelected(group.groupId);
                        const isExpanded = expandedGroups[group.groupId];
                        
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
                                                <div className="flex items-center space-x-2 mb-2">
                                                    <h3 className="text-sm font-medium text-gray-900">
                                                        {group.confidence ? `Confidence: ${group.confidence}` : `Similarity: ${(group.score * 100).toFixed(1)}%`}
                                                    </h3>
                                                    <div className="flex flex-wrap gap-1">
                                                        {group.reasons?.map((reason, index) => (
                                                            <span
                                                                key={index}
                                                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"
                                                            >
                                                                {reason}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                
                                                <div className="text-sm text-gray-600 mb-2">
                                                    {group.parts.length} parts • 
                                                    Will merge {group.parts.length - 1} part{group.parts.length - 1 !== 1 ? 's' : ''} into 1
                                                </div>

                                                {/* Quick preview of parts */}
                                                <div className="space-y-1">
                                                    {group.parts.slice(0, isExpanded ? undefined : 2).map((part) => (
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
                                                    
                                                    {!isExpanded && group.parts.length > 2 && (
                                                        <div className="text-xs text-gray-500">
                                                            +{group.parts.length - 2} more part{group.parts.length - 2 !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => toggleGroupExpansion(group.groupId)}
                                            className="text-gray-400 hover:text-gray-600 ml-2"
                                        >
                                            <Icon 
                                                path={isExpanded ? ICONS.chevronUp : ICONS.chevronDown} 
                                                className="h-5 w-5" 
                                            />
                                        </button>
                                    </div>

                                    {/* Expanded details */}
                                    {isExpanded && (
                                        <div className="mt-4 pt-4 border-t border-gray-200">
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
