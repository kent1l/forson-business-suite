import { useState, useEffect, useRef } from 'react';

export const ALL_STATUSES = ['Paid', 'Partially Paid', 'Unpaid', 'Partially Refunded', 'Fully Refunded', 'Cancelled'];
export const DEFAULT_STATUSES = ALL_STATUSES.filter(s => s !== 'Cancelled'); // hide voided by default

// Dropdown with checkboxes for selecting multiple invoice statuses to filter by
const StatusMultiSelect = ({ selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleStatus = (status) => {
        if (selected.includes(status)) {
            onChange(selected.filter(s => s !== status));
        } else {
            onChange([...selected, status]);
        }
    };

    const label = () => {
        if (selected.length === 0) return 'No statuses selected';
        if (selected.length === ALL_STATUSES.length) return 'All statuses';
        if (selected.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every(s => selected.includes(s))) return 'Active (hiding voided)';
        if (selected.length <= 2) return selected.join(', ');
        return `${selected.length} statuses selected`;
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm truncate"
            >
                <span className="truncate">{label()}</span>
                <svg className={`w-4 h-4 ml-2 flex-shrink-0 transform transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                </svg>
            </button>
            {open && (
                <div className="absolute z-20 mt-1 w-64 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg p-2">
                    <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100 dark:border-slate-700">
                        <button type="button" onClick={() => onChange(DEFAULT_STATUSES)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Hide voided</button>
                        <button type="button" onClick={() => onChange(ALL_STATUSES)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Select all</button>
                        <button type="button" onClick={() => onChange([])} className="text-xs text-gray-500 dark:text-slate-400 hover:underline">Clear</button>
                    </div>
                    {ALL_STATUSES.map(status => (
                        <label key={status} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer text-sm text-gray-700 dark:text-slate-200">
                            <input
                                type="checkbox"
                                checked={selected.includes(status)}
                                onChange={() => toggleStatus(status)}
                                className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                            />
                            {status}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

export default StatusMultiSelect;
