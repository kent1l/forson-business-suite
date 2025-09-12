import { useState } from 'react';

const ConflictResolver = ({ selectedGroups, keepParts, rules, onRulesChange }) => {
    const [expandedGroups, setExpandedGroups] = useState({});

    const toggleGroupExpansion = (groupId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    };

    const updateFieldOverride = (field, value) => {
        onRulesChange({
            ...rules,
            fieldOverrides: {
                ...rules.fieldOverrides,
                [field]: value
            }
        });
    };

    const updateMergeRule = (rule, value) => {
        onRulesChange({
            ...rules,
            [rule]: value
        });
    };

    const getFieldConflicts = (keepPart, mergeParts, field) => {
        const values = [keepPart[field], ...mergeParts.map(p => p[field])];
        const uniqueValues = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
        return uniqueValues.length > 1 ? uniqueValues : null;
    };

    const renderFieldResolver = (label, field, keepPart, mergeParts, type = 'text') => {
        const conflicts = getFieldConflicts(keepPart, mergeParts, field);
        if (!conflicts) return null;

        const currentValue = rules.fieldOverrides[field] || keepPart[field];

        return (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-yellow-800 mb-2">
                    Conflict in {label}
                </h4>
                <div className="space-y-2">
                    {conflicts.map((value, index) => (
                        <label key={index} className="flex items-center">
                            <input
                                type="radio"
                                name={field}
                                value={value}
                                checked={currentValue === value}
                                onChange={() => updateFieldOverride(field, value)}
                                className="mr-2"
                            />
                            <span className="text-sm">
                                {type === 'price' ? `₱${parseFloat(value).toFixed(2)}` : value}
                            </span>
                        </label>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Global Merge Rules */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Merge Rules</h2>
                <div className="space-y-4">
                    <label className="flex items-center">
                        <input
                            type="checkbox"
                            checked={rules.mergePartNumbers}
                            onChange={(e) => updateMergeRule('mergePartNumbers', e.target.checked)}
                            className="mr-3"
                        />
                        <div>
                            <div className="text-sm font-medium">Merge Part Numbers</div>
                            <div className="text-xs text-gray-500">
                                Combine all part numbers from merged parts (duplicates will be removed)
                            </div>
                        </div>
                    </label>

                    <label className="flex items-center">
                        <input
                            type="checkbox"
                            checked={rules.mergeApplications}
                            onChange={(e) => updateMergeRule('mergeApplications', e.target.checked)}
                            className="mr-3"
                        />
                        <div>
                            <div className="text-sm font-medium">Merge Applications</div>
                            <div className="text-xs text-gray-500">
                                Combine all vehicle applications from merged parts
                            </div>
                        </div>
                    </label>

                    <label className="flex items-center">
                        <input
                            type="checkbox"
                            checked={rules.mergeTags}
                            onChange={(e) => updateMergeRule('mergeTags', e.target.checked)}
                            className="mr-3"
                        />
                        <div>
                            <div className="text-sm font-medium">Merge Tags</div>
                            <div className="text-xs text-gray-500">
                                Combine all tags from merged parts
                            </div>
                        </div>
                    </label>
                </div>
            </div>

            {/* Field Conflicts per Group */}
            {selectedGroups.map(group => {
                const keepPart = keepParts[group.groupId];
                const mergeParts = group.parts.filter(p => p.part_id !== keepPart.part_id);
                const isExpanded = expandedGroups[group.groupId];

                if (!keepPart || mergeParts.length === 0) return null;

                // Check for conflicts
                const conflictFields = [
                    'display_name',
                    'detail', 
                    'cost_price',
                    'sale_price',
                    'is_active',
                    'is_service'
                ];

                const hasConflicts = conflictFields.some(field => 
                    getFieldConflicts(keepPart, mergeParts, field)
                );

                return (
                    <div key={group.groupId} className="bg-white rounded-lg border border-gray-200 p-6">
                        <div 
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => toggleGroupExpansion(group.groupId)}
                        >
                            <div>
                                <h3 className="text-md font-semibold">
                                    Group: {group.reasons.join(', ')}
                                </h3>
                                <div className="text-sm text-gray-600">
                                    Keep: {keepPart.display_name} ({keepPart.internal_sku})
                                    {hasConflicts && (
                                        <span className="ml-2 text-yellow-600 font-medium">
                                            • Conflicts detected
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-gray-400">
                                {isExpanded ? '−' : '+'}
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="mt-4 space-y-4">
                                {/* Field conflict resolvers */}
                                {renderFieldResolver('Display Name', 'display_name', keepPart, mergeParts)}
                                {renderFieldResolver('Description', 'detail', keepPart, mergeParts)}
                                {renderFieldResolver('Cost Price', 'cost_price', keepPart, mergeParts, 'price')}
                                {renderFieldResolver('Sale Price', 'sale_price', keepPart, mergeParts, 'price')}

                                {/* Boolean field conflicts */}
                                {getFieldConflicts(keepPart, mergeParts, 'is_active') && (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                        <h4 className="text-sm font-medium text-yellow-800 mb-2">
                                            Conflict in Active Status
                                        </h4>
                                        <div className="space-y-2">
                                            <label className="flex items-center">
                                                <input
                                                    type="radio"
                                                    name={`is_active_${group.groupId}`}
                                                    checked={(rules.fieldOverrides.is_active ?? keepPart.is_active) === true}
                                                    onChange={() => updateFieldOverride('is_active', true)}
                                                    className="mr-2"
                                                />
                                                <span className="text-sm">Active</span>
                                            </label>
                                            <label className="flex items-center">
                                                <input
                                                    type="radio"
                                                    name={`is_active_${group.groupId}`}
                                                    checked={(rules.fieldOverrides.is_active ?? keepPart.is_active) === false}
                                                    onChange={() => updateFieldOverride('is_active', false)}
                                                    className="mr-2"
                                                />
                                                <span className="text-sm">Inactive</span>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {getFieldConflicts(keepPart, mergeParts, 'is_service') && (
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                        <h4 className="text-sm font-medium text-yellow-800 mb-2">
                                            Conflict in Service Status
                                        </h4>
                                        <div className="space-y-2">
                                            <label className="flex items-center">
                                                <input
                                                    type="radio"
                                                    name={`is_service_${group.groupId}`}
                                                    checked={(rules.fieldOverrides.is_service ?? keepPart.is_service) === true}
                                                    onChange={() => updateFieldOverride('is_service', true)}
                                                    className="mr-2"
                                                />
                                                <span className="text-sm">Service Item</span>
                                            </label>
                                            <label className="flex items-center">
                                                <input
                                                    type="radio"
                                                    name={`is_service_${group.groupId}`}
                                                    checked={(rules.fieldOverrides.is_service ?? keepPart.is_service) === false}
                                                    onChange={() => updateFieldOverride('is_service', false)}
                                                    className="mr-2"
                                                />
                                                <span className="text-sm">Physical Item</span>
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {!hasConflicts && (
                                    <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg p-3">
                                        No field conflicts detected. All fields will use values from the kept part.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {selectedGroups.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                    No groups selected for conflict resolution
                </div>
            )}
        </div>
    );
};

export default ConflictResolver;
