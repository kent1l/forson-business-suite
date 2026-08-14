import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Employee × day attendance matrix.
 *
 * The flat record table answers "what does this one row say?"; this answers
 * "who was in this period?" — the question HR actually scans for. One row per
 * employee, one column per day, each cell a colour-coded day type that can be
 * changed in place.
 */

const DAY_TYPES = [
    'Present', 'Half Day', 'Absent', 'On Leave',
    'Rest Day', 'Rest Day Worked', 'Holiday', 'Holiday Worked', 'Suspended',
];

// Abbreviations keep a cell narrow enough that a full cutoff fits on screen
// without horizontal scrolling on a laptop.
const DAY_META = {
    'Present': { code: 'P', cell: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800' },
    'Half Day': { code: '½', cell: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800' },
    'Absent': { code: 'A', cell: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-800' },
    'On Leave': { code: 'L', cell: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800' },
    'Rest Day': { code: 'R', cell: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600' },
    'Rest Day Worked': { code: 'RW', cell: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-800' },
    'Holiday': { code: 'H', cell: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-800' },
    'Holiday Worked': { code: 'HW', cell: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-800' },
    'Suspended': { code: 'S', cell: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-800' },
};

const EMPTY_CELL = 'bg-transparent text-gray-300 border-dashed border-gray-200 dark:text-slate-600 dark:border-slate-700';

const iso = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Dates are built locally, not via UTC parsing, so a cell never lands a day off. */
const dayList = (from, to) => {
    const out = [];
    if (!from || !to) return out;
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const cursor = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td);
    // A wide accidental range (a mistyped year) would otherwise render
    // thousands of columns and lock the tab up.
    while (cursor <= end && out.length <= 62) {
        out.push({ date: iso(cursor), dom: cursor.getDate(), dow: cursor.getDay() });
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
};

const DOW_LABEL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const AttendanceGrid = ({ records, period, canEdit, onChangeDayType, savingId }) => {
    const [openCell, setOpenCell] = useState(null);
    const popoverRef = useRef(null);

    const days = useMemo(() => dayList(period.from, period.to), [period.from, period.to]);

    // employee_id -> { name, byDate: { 'YYYY-MM-DD': record } }
    const rows = useMemo(() => {
        const map = new Map();
        records.forEach((r) => {
            const id = r.employee_id;
            if (!map.has(id)) {
                map.set(id, { employee_id: id, name: r.employee_name, byDate: {} });
            }
            map.get(id).byDate[String(r.work_date).slice(0, 10)] = r;
        });
        return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }, [records]);

    useEffect(() => {
        if (!openCell) return undefined;
        const onDocClick = (e) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpenCell(null);
        };
        const onEsc = (e) => { if (e.key === 'Escape') setOpenCell(null); };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [openCell]);

    const pick = async (record, dayType) => {
        setOpenCell(null);
        if (record.day_type !== dayType) await onChangeDayType(record, dayType);
    };

    return (
        <div className="space-y-4">
            <div className="overflow-x-auto">
                <table className="border-separate" style={{ borderSpacing: '2px' }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 text-left px-2 pb-2 text-xs font-semibold text-gray-600 dark:text-slate-400">
                                Employee
                            </th>
                            {days.map((d) => (
                                <th key={d.date}
                                    className={`px-1 pb-2 text-center text-[10px] font-semibold leading-tight ${
                                        d.dow === 0 || d.dow === 6
                                            ? 'text-gray-400 dark:text-slate-500'
                                            : 'text-gray-600 dark:text-slate-400'
                                    }`}>
                                    <div className="tabular-nums">{d.dom}</div>
                                    <div className="font-normal">{DOW_LABEL[d.dow]}</div>
                                </th>
                            ))}
                            <th className="px-2 pb-2 text-right text-xs font-semibold text-gray-600 dark:text-slate-400 whitespace-nowrap">
                                Days
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const paid = days.reduce(
                                (sum, d) => sum + Number(row.byDate[d.date]?.day_fraction || 0), 0);
                            return (
                                <tr key={row.employee_id}>
                                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-2 py-1 text-sm font-medium text-gray-800 dark:text-slate-100 whitespace-nowrap">
                                        {row.name}
                                    </td>
                                    {days.map((d) => {
                                        const rec = row.byDate[d.date];
                                        const meta = rec ? DAY_META[rec.day_type] : null;
                                        const cellKey = `${row.employee_id}|${d.date}`;
                                        const editable = canEdit && rec && !rec.is_locked;
                                        const busy = rec && savingId === rec.dtr_id;
                                        return (
                                            <td key={d.date} className="p-0 relative">
                                                <button
                                                    type="button"
                                                    disabled={!editable || busy}
                                                    onClick={() => setOpenCell(openCell === cellKey ? null : cellKey)}
                                                    title={rec
                                                        ? `${row.name} — ${d.date}: ${rec.day_type}${rec.is_locked ? ' (locked by payroll)' : ''}`
                                                        : `${row.name} — ${d.date}: no record`}
                                                    className={`w-8 h-8 border rounded text-[11px] font-bold tabular-nums transition
                                                        ${meta ? meta.cell : EMPTY_CELL}
                                                        ${editable ? 'cursor-pointer hover:ring-2 hover:ring-primary-400' : 'cursor-default'}
                                                        ${busy ? 'opacity-40' : ''}
                                                        ${rec?.is_locked ? 'ring-1 ring-inset ring-gray-400/60 dark:ring-slate-500/60' : ''}`}
                                                >
                                                    {meta ? meta.code : '·'}
                                                </button>

                                                {openCell === cellKey && editable && (
                                                    <div ref={popoverRef}
                                                        className="absolute z-30 mt-1 left-0 w-40 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg py-1">
                                                        {DAY_TYPES.map((t) => (
                                                            <button
                                                                key={t}
                                                                type="button"
                                                                onClick={() => pick(rec, t)}
                                                                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-gray-100 dark:hover:bg-slate-700 ${
                                                                    rec.day_type === t
                                                                        ? 'font-bold text-gray-900 dark:text-slate-50'
                                                                        : 'text-gray-600 dark:text-slate-300'
                                                                }`}
                                                            >
                                                                <span className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold ${DAY_META[t].cell}`}>
                                                                    {DAY_META[t].code}
                                                                </span>
                                                                {t}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="px-2 py-1 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-50">
                                        {(Math.round(paid * 100) / 100).toFixed(2)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-gray-100 dark:border-slate-700">
                {DAY_TYPES.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-400">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold ${DAY_META[t].cell}`}>
                            {DAY_META[t].code}
                        </span>
                        {t}
                    </span>
                ))}
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-500">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold ${EMPTY_CELL}`}>·</span>
                    No record
                </span>
            </div>
        </div>
    );
};

export default AttendanceGrid;
