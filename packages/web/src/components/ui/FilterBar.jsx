import React from 'react';

const FilterBar = ({ tabs, activeTab, onTabClick }) => {
    return (
        <div className="mb-4">
            <div className="flex space-x-4 border-b border-gray-200 dark:border-slate-700">
                {tabs.map(tab => (
                    <button 
                        key={tab.key}
                        onClick={() => onTabClick(tab.key)} 
                        className={`py-2 px-4 text-sm font-medium transition-colors ${activeTab === tab.key 
                            ? 'border-b-2 border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400' 
                            : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default FilterBar;