import React from 'react';

const FilterBar = ({ tabs, activeTab, onTabClick }) => {
    return (
        <div className="mb-4">
            <div className="flex space-x-4 border-b">
                {tabs.map(tab => (
                    <button 
                        key={tab.key}
                        onClick={() => onTabClick(tab.key)} 
                        className={`py-2 px-4 text-sm font-medium ${activeTab === tab.key 
                            ? 'border-b-2 border-blue-600 text-blue-600' 
                            : 'text-gray-500'
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