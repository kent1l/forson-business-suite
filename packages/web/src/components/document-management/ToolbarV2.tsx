import React from 'react';
import { DocumentSearchFilters } from './types';
import { IconSearch, IconGrid, IconList, IconFilter } from './Icons';

interface ToolbarProps {
    filters: DocumentSearchFilters;
    onSearchChange: (query: string) => void;
    onViewChange: (view: 'grid' | 'list') => void;
    currentView: 'grid' | 'list';
    onFilterToggle: () => void;
}

export const ToolbarV2: React.FC<ToolbarProps> = ({ filters, onSearchChange, onViewChange, currentView, onFilterToggle }) => (
    <div className="flex-shrink-0 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="relative w-full max-w-sm">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <IconSearch className="h-5 w-5 text-gray-400" />
            </div>
            <input
                type="text"
                placeholder="Search..."
                defaultValue={filters.searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                className="w-full bg-gray-100 border-transparent rounded-md pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
        </div>
        <div className="flex items-center space-x-2">
            <button onClick={onFilterToggle} className="p-2 text-gray-500 hover:bg-gray-100 rounded-md">
                <IconFilter className="h-5 w-5" />
            </button>
            <div className="flex items-center bg-gray-100 rounded-md p-0.5">
                <button onClick={() => onViewChange('list')} className={`p-1.5 rounded ${currentView === 'list' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
                    <IconList className="h-5 w-5"/>
                </button>
                <button onClick={() => onViewChange('grid')} className={`p-1.5 rounded ${currentView === 'grid' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
                    <IconGrid className="h-5 w-5"/>
                </button>
            </div>
        </div>
    </div>
);

export default ToolbarV2;
