import { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import SearchBar from '../SearchBar';

const DuplicateGroupList = ({ selectedGroups, onSelectionChange }) => {
    const [duplicateGroups, setDuplicateGroups] = useState([]);
    const [manualSearchResults, setManualSearchResults] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [strategy, setStrategy] = useState('auto');

    useEffect(() => {
        fetchDuplicateGroups();
    }, [strategy]);

    useEffect(() => {
        if (searchTerm.trim()) {
            const debounceTimer = setTimeout(() => {
                searchPartsForMerge(searchTerm);
            }, 300);
            return () => clearTimeout(debounceTimer);
        } else {
            setManualSearchResults([]);
        }
    }, [searchTerm]);

    const fetchDuplicateGroups = async () => {
        try {
            setLoading(true);
            const response = await api.get('/parts/duplicates', {
                params: { strategy, limit: 50 }
            });
            setDuplicateGroups(response.data);
        } catch (error) {
            console.error('Error fetching duplicate groups:', error);
            toast.error('Failed to load duplicate groups: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    };

    const searchPartsForMerge = async (query) => {
        try {
            setSearchLoading(true);
            const response = await api.get('/parts/search-for-merge', {
                params: { q: query, limit: 20 }
            });
            setManualSearchResults(response.data);
        } catch (error) {
            console.error('Error searching parts:', error);
            toast.error('Failed to search parts: ' + (error.response?.data?.message || error.message));
        } finally {
            setSearchLoading(false);
        }
    };

    const handleGroupSelection = (group) => {
        const isSelected = selectedGroups.some(g => g.groupId === group.groupId);
        if (isSelected) {
            onSelectionChange(selectedGroups.filter(g => g.groupId !== group.groupId));
        } else {
            onSelectionChange([...selectedGroups, group]);
        }
    };

    const createManualGroup = (parts) => {
        if (parts.length < 2) {
            toast.error('Select at least 2 parts to create a merge group');
            return;
        }

        const manualGroup = {
            groupId: `manual_${Date.now()}`,
            score: 1.0,
            reasons: ['manual_selection'],
            parts: parts
        };

        onSelectionChange([...selectedGroups, manualGroup]);
        setManualSearchResults([]);
        setSearchTerm('');
        toast.success('Manual group created successfully');
    };

    const [selectedManualParts, setSelectedManualParts] = useState([]);

    const handleManualPartSelection = (part) => {
        const isSelected = selectedManualParts.some(p => p.part_id === part.part_id);
        if (isSelected) {
            setSelectedManualParts(selectedManualParts.filter(p => p.part_id !== part.part_id));
        } else {
            setSelectedManualParts([...selectedManualParts, part]);
        }
    };

    const renderPartCard = (part, onClick, isSelected = false) => (
        <div
            key={part.part_id}
            onClick={onClick}
            className={`
                p-3 border rounded-lg cursor-pointer transition-all
                ${isSelected 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
            `}
        >
            <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                        {part.display_name}
                    </div>
                    <div className="text-xs text-gray-500 font-mono">
                        SKU: {part.internal_sku}
                    </div>
                    <div className="text-xs text-gray-500">
                        {part.brand_name} • {part.group_name}
                    </div>
                    {part.tags && part.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {part.tags.slice(0, 3).map((tag, index) => (
                                <span key={index} className="text-xs bg-gray-100 text-gray-600 px-1 py-0.5 rounded">
                                    {tag}
                                </span>
                            ))}
                            {part.tags.length > 3 && (
                                <span className="text-xs text-gray-400">+{part.tags.length - 3}</span>
                            )}
                        </div>
                    )}
                </div>
                {isSelected && (
                    <Icon path={ICONS.check} className="h-4 w-4 text-blue-600 flex-shrink-0 ml-2" />
                )}
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Find Duplicate Parts</h2>
                
                {/* Strategy Selection */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Detection Strategy
                    </label>
                    <div className="flex space-x-4">
                        {[
                            { value: 'auto', label: 'Auto (Recommended)' },
                            { value: 'strict', label: 'Strict' },
                            { value: 'loose', label: 'Loose' }
                        ].map(option => (
                            <label key={option.value} className="flex items-center">
                                <input
                                    type="radio"
                                    value={option.value}
                                    checked={strategy === option.value}
                                    onChange={(e) => setStrategy(e.target.value)}
                                    className="mr-2"
                                />
                                <span className="text-sm">{option.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Summary */}
                <div className="text-sm text-gray-600">
                    Found {duplicateGroups.length} potential duplicate groups. 
                    Selected {selectedGroups.length} groups for merging.
                </div>
            </div>

            {/* Suggested Duplicates */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-md font-semibold mb-4">Suggested Duplicates</h3>
                
                {loading ? (
                    <div className="text-center py-8">
                        <div className="text-gray-500">Loading duplicate groups...</div>
                    </div>
                ) : duplicateGroups.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-gray-500">No duplicate groups found with current strategy</div>
                        <div className="text-sm text-gray-400 mt-1">Try using a different detection strategy</div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {duplicateGroups.map(group => {
                            const isSelected = selectedGroups.some(g => g.groupId === group.groupId);
                            return (
                                <div
                                    key={group.groupId}
                                    className={`
                                        border rounded-lg p-4 cursor-pointer transition-all
                                        ${isSelected 
                                            ? 'border-blue-500 bg-blue-50' 
                                            : 'border-gray-200 hover:border-gray-300'
                                        }
                                    `}
                                    onClick={() => handleGroupSelection(group)}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center space-x-3">
                                            <div className={`
                                                w-5 h-5 rounded border-2 flex items-center justify-center
                                                ${isSelected 
                                                    ? 'border-blue-500 bg-blue-500' 
                                                    : 'border-gray-300'
                                                }
                                            `}>
                                                {isSelected && (
                                                    <Icon path={ICONS.check} className="h-3 w-3 text-white" />
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium">
                                                    {group.reasons.join(', ')} (Score: {group.score.toFixed(2)})
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {group.parts.length} parts in this group
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {group.parts.map(part => 
                                            renderPartCard(part, (e) => e.stopPropagation())
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Manual Selection */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-md font-semibold mb-4">Manual Selection</h3>
                <p className="text-sm text-gray-600 mb-4">
                    Search and manually select parts to merge together
                </p>
                
                <div className="mb-4">
                    <SearchBar
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onClear={() => setSearchTerm('')}
                        placeholder="Search by name, SKU, or part number..."
                    />
                </div>

                {searchLoading && (
                    <div className="text-center py-4">
                        <div className="text-gray-500">Searching...</div>
                    </div>
                )}

                {manualSearchResults.length > 0 && (
                    <div className="space-y-3 mb-4">
                        <div className="text-sm font-medium text-gray-700">
                            Search Results (click to select)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto">
                            {manualSearchResults.map(part => 
                                renderPartCard(
                                    part, 
                                    () => handleManualPartSelection(part),
                                    selectedManualParts.some(p => p.part_id === part.part_id)
                                )
                            )}
                        </div>
                    </div>
                )}

                {selectedManualParts.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-gray-700">
                                Selected Parts ({selectedManualParts.length})
                            </div>
                            <div className="space-x-2">
                                <button
                                    onClick={() => setSelectedManualParts([])}
                                    className="text-sm text-gray-500 hover:text-gray-700"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={() => createManualGroup(selectedManualParts)}
                                    disabled={selectedManualParts.length < 2}
                                    className={`
                                        px-3 py-1 text-sm rounded
                                        ${selectedManualParts.length >= 2
                                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                        }
                                    `}
                                >
                                    Create Group
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {selectedManualParts.map(part => 
                                renderPartCard(
                                    part, 
                                    () => handleManualPartSelection(part),
                                    true
                                )
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DuplicateGroupList;
