import React, { useState } from 'react';
import { DocumentSearchFilters, DocumentType } from './types';

const DOCUMENT_TYPES: DocumentType[] = ['GRN', 'Sales', 'Invoice', 'PurchaseOrders'];
const DATE_PRESETS = [7, 30, 90, 365];

interface FilterSidebarProps {
    filters: DocumentSearchFilters;
    applyFilters: (newFilters: Partial<DocumentSearchFilters>) => void;
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({ filters, applyFilters }) => {
    // State for custom date inputs
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    const handleCustomDateApply = () => {
        if (customFrom && customTo) {
            applyFilters({ datePreset: 'custom' as any, from: customFrom, to: customTo });
        }
    };
    return (
        <aside className="w-64 bg-white border-r border-gray-200 p-4 flex-shrink-0">
            <h2 className="text-lg font-semibold mb-4">Documents</h2>
            <div className="space-y-6">
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">TYPE</h3>
                    <div className="space-y-1">
                        {['All', ...DOCUMENT_TYPES].map(type => (
                            <button
                                key={type}
                                onClick={() => applyFilters({ type: type as any })}
                                className={`w-full text-left px-3 py-1.5 rounded-md text-sm ${filters.type === type ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-gray-100'}`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">DATE RANGE</h3>
                     <div className="space-y-1">
                        {DATE_PRESETS.map(days => (
                            <button
                                key={days}
                                onClick={() => applyFilters({ datePreset: days as any, from: undefined, to: undefined })}
                                className={`w-full text-left px-3 py-1.5 rounded-md text-sm ${filters.datePreset === days ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-gray-100'}`}
                            >
                                Last {days} days
                            </button>
                        ))}
                        <button
                            onClick={() => applyFilters({ datePreset: 'custom' as any })}
                            className={`w-full text-left px-3 py-1.5 rounded-md text-sm ${filters.datePreset === 'custom' ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-gray-100'}`}
                        >
                            Custom Range
                        </button>
                        {filters.datePreset === 'custom' && (
                            <div className="p-2 space-y-2 border-t">
                                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full border-gray-200 rounded-md text-sm" />
                                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full border-gray-200 rounded-md text-sm" />
                                <button onClick={handleCustomDateApply} className="w-full bg-blue-600 text-white rounded-md py-1 text-sm">Apply</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </aside>
    );
};
