import React from 'react';
import { format, addDays, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const DateRangeShortcuts = ({ onSelect }) => {
    const now = new Date();
    const today = toZonedTime(now, 'Asia/Manila');
    const todayStr = format(today, 'yyyy-MM-dd');

    const shortcuts = [
        {
            label: 'Today',
            getRange: () => ({ startDate: todayStr, endDate: todayStr })
        },
        {
            label: 'Yesterday',
            getRange: () => {
                const yesterday = subDays(today, 1);
                const yesterdayStr = format(yesterday, 'yyyy-MM-dd');
                return { startDate: yesterdayStr, endDate: yesterdayStr };
            }
        },
        {
            label: 'Last 7 Days',
            getRange: () => {
                const pastDate = subDays(today, 6);
                return { startDate: format(pastDate, 'yyyy-MM-dd'), endDate: todayStr };
            }
        },
        {
            label: 'Last 30 Days',
            getRange: () => {
                const pastDate = subDays(today, 29);
                return { startDate: format(pastDate, 'yyyy-MM-dd'), endDate: todayStr };
            }
        },
        {
            label: 'This Month',
            getRange: () => {
                const firstDay = startOfMonth(today);
                return { startDate: format(firstDay, 'yyyy-MM-dd'), endDate: todayStr };
            }
        },
        {
            label: 'Last Month',
            getRange: () => {
                const lastMonth = subMonths(today, 1);
                const firstDay = startOfMonth(lastMonth);
                const lastDay = endOfMonth(lastMonth);
                return { startDate: format(firstDay, 'yyyy-MM-dd'), endDate: format(lastDay, 'yyyy-MM-dd') };
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