import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const ImpactSummary = ({ mergePreview, loading }) => {
    if (loading) {
        return (
            <div className="text-center py-12">
                <div className="text-gray-500">Calculating merge impact...</div>
                <div className="text-sm text-gray-400 mt-2">This may take a moment</div>
            </div>
        );
    }

    if (!mergePreview || mergePreview.length === 0) {
        return (
            <div className="text-center py-12">
                <div className="text-gray-500">No merge preview available</div>
            </div>
        );
    }

    const getTotalCounts = () => {
        const totals = {};
        mergePreview.forEach(item => {
            Object.entries(item.preview.impact.byTable).forEach(([table, count]) => {
                totals[table] = (totals[table] || 0) + count;
            });
        });
        return totals;
    };

    const getAllWarnings = () => {
        return mergePreview.flatMap(item => item.preview.warnings || []);
    };

    const getAllConflicts = () => {
        return mergePreview.flatMap(item => item.preview.conflicts || []);
    };

    const totalCounts = getTotalCounts();
    const allWarnings = getAllWarnings();
    const allConflicts = getAllConflicts();
    const totalRecords = Object.values(totalCounts).reduce((sum, count) => sum + count, 0);

    return (
        <div className="space-y-6">
            {/* Overview Summary */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Merge Impact Summary</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="text-2xl font-bold text-blue-700">
                            {mergePreview.length}
                        </div>
                        <div className="text-sm text-blue-600">Groups to merge</div>
                    </div>
                    
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="text-2xl font-bold text-green-700">
                            {mergePreview.reduce((sum, item) => sum + item.mergeParts.length, 0)}
                        </div>
                        <div className="text-sm text-green-600">Parts to be merged</div>
                    </div>
                    
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <div className="text-2xl font-bold text-purple-700">
                            {totalRecords.toLocaleString()}
                        </div>
                        <div className="text-sm text-purple-600">Total records to update</div>
                    </div>
                </div>

                {/* Performance Warning */}
                {totalRecords > 1000 && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                        <div className="flex items-center">
                            <Icon path={ICONS.warning} className="h-5 w-5 text-yellow-600 mr-2" />
                            <div className="text-yellow-800 font-medium">Large Operation Warning</div>
                        </div>
                        <div className="text-yellow-700 text-sm mt-1">
                            This merge will update {totalRecords.toLocaleString()} records. Consider performing this during low-traffic hours.
                        </div>
                    </div>
                )}
            </div>

            {/* Table-by-Table Breakdown */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-md font-semibold mb-4">Records to be Updated</h3>
                
                {Object.keys(totalCounts).length > 0 ? (
                    <div className="space-y-3">
                        {Object.entries(totalCounts)
                            .filter(([, count]) => count > 0)
                            .sort(([, a], [, b]) => b - a)
                            .map(([table, count]) => (
                                <div key={table} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                                    <div className="text-sm font-medium text-gray-700 capitalize">
                                        {table.replace(/_/g, ' ')}
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900">
                                        {count.toLocaleString()} record{count !== 1 ? 's' : ''}
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                ) : (
                    <div className="text-sm text-gray-500 italic">
                        No related records found
                    </div>
                )}
            </div>

            {/* Inventory Impact */}
            {mergePreview.some(item => item.preview.impact.inventory?.locations?.length > 0) && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-md font-semibold mb-4">Inventory Impact</h3>
                    
                    <div className="space-y-4">
                        {mergePreview.map((item, index) => {
                            const locations = item.preview.impact.inventory?.locations || [];
                            if (locations.length === 0) return null;

                            return (
                                <div key={index} className="border border-gray-100 rounded-lg p-4">
                                    <h4 className="text-sm font-medium mb-2">
                                        {item.keepPart.display_name} ({item.keepPart.internal_sku})
                                    </h4>
                                    <div className="space-y-2">
                                        {locations.map((location, locIndex) => (
                                            <div key={locIndex} className="flex justify-between items-center text-sm">
                                                <span>Location {location.location_id}</span>
                                                <span>
                                                    Qty: {location.quantity} | WAC: ₱{location.avg_wac?.toFixed(2) || '0.00'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-4 text-xs text-gray-500 bg-gray-50 p-3 rounded">
                        <strong>Note:</strong> Inventory quantities will be consolidated by location. 
                        Weighted Average Cost (WAC) will be recalculated automatically.
                    </div>
                </div>
            )}

            {/* Conflicts */}
            {allConflicts.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-md font-semibold mb-4 text-yellow-700">Conflicts Detected</h3>
                    
                    <div className="space-y-3">
                        {allConflicts.map((conflict, index) => (
                            <div key={index} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                                <div className="flex items-center">
                                    <Icon path={ICONS.warning} className="h-4 w-4 text-yellow-600 mr-2" />
                                    <div className="text-sm font-medium text-yellow-800">
                                        {conflict.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                    </div>
                                </div>
                                <div className="text-sm text-yellow-700 mt-1">
                                    {conflict.description}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Warnings */}
            {allWarnings.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-md font-semibold mb-4 text-orange-700">Warnings</h3>
                    
                    <div className="space-y-2">
                        {allWarnings.map((warning, index) => (
                            <div key={index} className="flex items-center text-sm text-orange-700">
                                <Icon path={ICONS.info} className="h-4 w-4 mr-2" />
                                <span>{warning}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Group Details */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-md font-semibold mb-4">Merge Details by Group</h3>
                
                <div className="space-y-4">
                    {mergePreview.map((item, index) => (
                        <div key={index} className="border border-gray-100 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h4 className="text-sm font-medium text-green-700">
                                        Keep: {item.keepPart.display_name}
                                    </h4>
                                    <div className="text-xs text-gray-500 font-mono">
                                        {item.keepPart.internal_sku}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-400">
                                    Group {index + 1}
                                </div>
                            </div>
                            
                            <div className="mb-3">
                                <div className="text-xs text-gray-600 mb-1">Merging:</div>
                                <div className="space-y-1">
                                    {item.mergeParts.map(part => (
                                        <div key={part.part_id} className="text-xs text-red-600">
                                            → {part.display_name} ({part.internal_sku})
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                {Object.entries(item.preview.impact.byTable)
                                    .filter(([, count]) => count > 0)
                                    .map(([table, count]) => (
                                        <div key={table} className="bg-gray-50 p-2 rounded">
                                            <div className="font-medium">{count}</div>
                                            <div className="text-gray-500 capitalize">
                                                {table.replace(/_/g, ' ')}
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Final Warning */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <div className="flex items-center mb-2">
                    <Icon path={ICONS.warning} className="h-5 w-5 text-red-600 mr-2" />
                    <div className="text-red-800 font-medium">Important Notice</div>
                </div>
                <div className="text-red-700 text-sm space-y-1">
                    <p>• This operation cannot be easily undone</p>
                    <p>• Merged parts will be marked as inactive and their SKUs will be modified</p>
                    <p>• All references will be redirected to the kept parts</p>
                    <p>• Consider creating a database backup before proceeding</p>
                </div>
            </div>
        </div>
    );
};

export default ImpactSummary;
