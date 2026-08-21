import React from 'react';
import { format, addDays, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Anchor date for the "All Time" preset — earlier than any real business record, avoiding a
// separate query just to discover the actual earliest date.
const EARLIEST_DATE = '2000-01-01';

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
        },
        {
            label: 'All Time',
            // Backend date filters require a concrete BETWEEN range, so "all time" is expressed as
            // a fixed anchor far earlier than any real business record rather than an open-ended query.
            getRange: () => ({ startDate: EARLIEST_DATE, endDate: todayStr })
        }
    ];

    return (
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            {shortcuts.map(s => (
                <button
                    key={s.label}
                    type="button"
                    onClick={() => onSelect(s.getRange())}
                    className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                    {s.label}
                </button>
            ))}
        </div>
    );
};

export default DateRangeShortcuts;