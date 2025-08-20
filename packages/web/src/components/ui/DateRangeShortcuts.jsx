import React from 'react';

const DateRangeShortcuts = ({ onSelect }) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const shortcuts = [
        {
            label: 'Today',
            getRange: () => ({ startDate: todayStr, endDate: todayStr })
        },
        {
            label: 'Yesterday',
            getRange: () => {
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                return { startDate: yesterdayStr, endDate: yesterdayStr };
            }
        },
        {
            label: 'Last 7 Days',
            getRange: () => {
                const pastDate = new Date(today);
                pastDate.setDate(today.getDate() - 6);
                return { startDate: pastDate.toISOString().split('T')[0], endDate: todayStr };
            }
        },
        {
            label: 'Last 30 Days',
            getRange: () => {
                const pastDate = new Date(today);
                pastDate.setDate(today.getDate() - 29);
                return { startDate: pastDate.toISOString().split('T')[0], endDate: todayStr };
            }
        },
        {
            label: 'This Month',
            getRange: () => {
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                return { startDate: firstDay.toISOString().split('T')[0], endDate: todayStr };
            }
        },
        {
            label: 'Last Month',
            getRange: () => {
                const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
                return { startDate: lastMonth.toISOString().split('T')[0], endDate: lastDay.toISOString().split('T')[0] };
            }
        }
    ];

    return (
        <div className="flex items-center space-x-2">
            {shortcuts.map(s => (
                <button
                    key={s.label}
                    type="button"
                    onClick={() => onSelect(s.getRange())}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                >
                    {s.label}
                </button>
            ))}
        </div>
    );
};

export default DateRangeShortcuts;