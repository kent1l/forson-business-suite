import { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const PartCompareCard = ({ part, isSelected, onSelect }) => {
    const [showDetails, setShowDetails] = useState(false);

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    const formatPrice = (price) => {
        if (!price) return 'N/A';
        return `₱${parseFloat(price).toFixed(2)}`;
    };

    return (
        <div
            className={`
                border rounded-lg p-4 cursor-pointer transition-all
                ${isSelected 
                    ? 'border-blue-500 bg-blue-50 shadow-md' 
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }
            `}
            onClick={onSelect}
        >
            {/* Header with selection indicator */}
            <div className="flex items-center justify-between mb-3">
                <div className={`
                    w-6 h-6 rounded-full border-2 flex items-center justify-center
                    ${isSelected 
                        ? 'border-blue-500 bg-blue-500' 
                        : 'border-gray-300'
                    }
                `}>
                    {isSelected && (
                        <Icon path={ICONS.check} className="h-4 w-4 text-white" />
                    )}
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowDetails(!showDetails);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                >
                    <Icon 
                        path={showDetails ? ICONS.chevronUp : ICONS.chevronDown} 
                        className="h-4 w-4" 
                    />
                </button>
            </div>

            {/* Main part info */}
            <div className="space-y-2">
                <div className="text-sm font-medium text-gray-900">
                    {part.display_name || 'Unnamed Part'}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                    SKU: {part.internal_sku}
                </div>
                <div className="text-xs text-gray-600">
                    {part.brand_name || 'No Brand'} • {part.group_name || 'No Group'}
                </div>
            </div>

            {/* Quick info badges */}
            <div className="flex flex-wrap gap-1 mt-3">
                {part.is_active !== undefined && (
                    <span className={`
                        text-xs px-2 py-1 rounded-full
                        ${part.is_active 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }
                    `}>
                        {part.is_active ? 'Active' : 'Inactive'}
                    </span>
                )}
                {part.is_service && (
                    <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">
                        Service
                    </span>
                )}
                {part.tags && part.tags.length > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                        {part.tags.length} tag{part.tags.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {/* Expanded details */}
            {showDetails && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3 text-xs">
                    {/* Pricing */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-gray-500">Cost Price:</span>
                            <div className="font-medium">{formatPrice(part.cost_price)}</div>
                        </div>
                        <div>
                            <span className="text-gray-500">Sale Price:</span>
                            <div className="font-medium">{formatPrice(part.sale_price)}</div>
                        </div>
                    </div>

                    {/* Part Numbers */}
                    {part.part_numbers && part.part_numbers.length > 0 && (
                        <div>
                            <span className="text-gray-500">Part Numbers:</span>
                            <div className="mt-1 space-y-1">
                                {part.part_numbers.slice(0, 3).map((pn, index) => (
                                    <div key={index} className="font-mono text-xs">
                                        {pn.part_number} ({pn.part_number_type})
                                    </div>
                                ))}
                                {part.part_numbers.length > 3 && (
                                    <div className="text-gray-400">
                                        +{part.part_numbers.length - 3} more
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Applications */}
                    {part.applications && part.applications.length > 0 && (
                        <div>
                            <span className="text-gray-500">Applications:</span>
                            <div className="mt-1 space-y-1">
                                {part.applications.slice(0, 2).map((app, index) => (
                                    <div key={index} className="text-xs">
                                        {app.make} {app.model} {app.engine}
                                        {app.year_start && app.year_end && (
                                            <span className="text-gray-400 ml-1">
                                                ({app.year_start}-{app.year_end})
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {part.applications.length > 2 && (
                                    <div className="text-gray-400">
                                        +{part.applications.length - 2} more
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Tags */}
                    {part.tags && part.tags.length > 0 && (
                        <div>
                            <span className="text-gray-500">Tags:</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {part.tags.slice(0, 5).map((tag, index) => (
                                    <span key={index} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                        {tag}
                                    </span>
                                ))}
                                {part.tags.length > 5 && (
                                    <span className="text-xs text-gray-400">+{part.tags.length - 5}</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <span className="text-gray-500">Created:</span>
                            <div>{formatDate(part.created_at)}</div>
                        </div>
                        <div>
                            <span className="text-gray-500">Modified:</span>
                            <div>{formatDate(part.modified_at)}</div>
                        </div>
                    </div>

                    {/* Detail description */}
                    {part.detail && (
                        <div>
                            <span className="text-gray-500">Description:</span>
                            <div className="mt-1 text-xs text-gray-700 italic">
                                "{part.detail}"
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PartCompareCard;
