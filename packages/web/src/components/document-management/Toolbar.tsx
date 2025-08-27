import React from 'react';
import { DocumentSearchFilters } from './types';
import { IconSearch, IconSortAscending, IconSortDescending } from './Icons';

interface ToolbarProps {
    filters: DocumentSearchFilters;
    setFilters: React.Dispatch<React.SetStateAction<DocumentSearchFilters>>;
}

export const Toolbar: React.FC<ToolbarProps> = ({ filters, setFilters }) => {
    const handleSortDirChange = () => {
        setFilters(f => ({ ...f, sortDir: f.sortDir === 'desc' ? 'asc' : 'desc' }));
    };

    return (
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
            <div className="relative w-full max-w-xs">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <IconSearch className="h-5 w-5 text-gray-400" />
                </div>
                <input
                    type="text"
                    placeholder="Search documents..."
                    value={filters.searchQuery}
                    onChange={e => setFilters(f => ({ ...f, searchQuery: e.target.value, page: 1 }))}
                    className="w-full bg-gray-100 border-transparent rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>
            <div className="flex items-center space-x-2">
                 <select
                    value={filters.sortBy}
                    onChange={e => setFilters(f => ({ ...f, sortBy: e.target.value as any, page: 1 }))}
                    className="bg-gray-100 border-transparent rounded-lg py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                    <option value="date">Sort by Date</option>
                    <option value="referenceId">Sort by Reference</option>
                    <option value="type">Sort by Type</option>
                </select>
                <button onClick={handleSortDirChange} className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                    {filters.sortDir === 'desc' ? <IconSortDescending className="h-5 w-5"/> : <IconSortAscending className="h-5 w-5"/>}
                </button>
            </div>
        </div>
    );
};
