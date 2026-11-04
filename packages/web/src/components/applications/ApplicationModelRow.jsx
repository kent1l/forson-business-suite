import { useMemo } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { summarizeApplicationModel } from '../../helpers/applicationModelSummary';
import { formatQualifierSummary, formatYearRange } from '../../utils/engineCodeFormat';
import { compareFitmentRows } from '../../utils/fitmentDisplayOrder';
import EngineCodeText from './EngineCodeText';

function SummaryList({ values, onExpand, label }) {
    return (
        <span className="leading-6 text-gray-700 dark:text-slate-300">
            {values.slice(0, 3).join(', ')}
            {values.length > 3 && (
                <button type="button" onClick={onExpand} aria-label={`Show all ${label}`} className="ml-1 rounded text-xs font-semibold text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-primary-500">
                    +{values.length - 3} more
                </button>
            )}
        </span>
    );
}

export default function ApplicationModelRow({ group, expanded, onToggle, canEdit, onEdit, onDelete }) {
    const rows = useMemo(() => [...group.combinations].sort(compareFitmentRows), [group.combinations]);
    const summary = useMemo(() => summarizeApplicationModel(rows), [rows]);
    const name = [group.make, group.model].filter(Boolean).join(' ') || [...new Set(rows.flatMap(row => [row.engine, row.chassis]).filter(Boolean))].join(', ');
    const detailsId = `combinations-${group.group_key}`;
    const expand = () => { if (!expanded) onToggle(); };

    return (
        <>
            <tr className={`border-b border-gray-100 align-top dark:border-slate-700 ${expanded ? 'bg-primary-50/40 dark:bg-slate-800' : 'hover:bg-gray-50/70 dark:hover:bg-slate-800/50'}`}>
                <td className="p-4 text-sm text-gray-600 dark:text-slate-400">{group.make}</td>
                <th scope="row" className="p-4 text-left">
                    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? 'Hide' : 'Show'} combinations for ${name}`} className="group flex items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-primary-500">
                        <Icon path={expanded ? ICONS.chevronUp : ICONS.chevronDown} className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span>
                            <span className="block text-sm font-semibold text-gray-900 group-hover:text-primary-600 dark:text-slate-100">{group.model}</span>
                            <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-slate-400">{rows.length} {rows.length === 1 ? 'combination' : 'combinations'}</span>
                        </span>
                    </button>
                </th>
                <td className="max-w-52 p-4">
                    <span title={summary.engines.join(', ')} className="break-words font-mono text-sm leading-6 text-gray-700 dark:text-slate-300">
                        {summary.engines.length <= 4 ? <EngineCodeText codes={summary.engines} /> : <SummaryList values={summary.engines} label={`engines for ${name}`} onExpand={expand} />}
                    </span>
                </td>
                <td className="max-w-48 p-4 font-mono"><SummaryList values={summary.chassis} label={`chassis for ${name}`} onExpand={expand} /></td>
                <td className="max-w-sm p-4">
                    <div className="flex flex-wrap gap-1.5">
                        {summary.classifications.slice(0, 3).map(({ label, values }) => (
                            <span key={label} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs leading-5 text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                <span className="mr-1 text-gray-500 dark:text-slate-400">{label}:</span>
                                <SummaryList values={values} onExpand={expand} label={`${label.toLowerCase()} for ${name}`} />
                            </span>
                        ))}
                        {summary.classifications.length > 3 && <button type="button" onClick={expand} className="rounded-md px-2 py-1 text-xs font-semibold text-primary-600 hover:bg-primary-50">+{summary.classifications.length - 3} details</button>}
                    </div>
                </td>
                <td className="p-4 text-right">
                    <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? 'Hide' : 'View'} combinations for ${name}`} className="whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-primary-300 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-primary-500 dark:border-slate-600 dark:text-slate-300">
                        {expanded ? 'Hide details' : 'View details'}
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr id={detailsId} className="border-b border-gray-200 dark:border-slate-700">
                    <td colSpan={6} className="bg-gray-50/80 p-4 dark:bg-slate-900/40">
                        <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                            <div className="border-b border-gray-100 px-4 py-3 dark:border-slate-700">
                                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{name} · Recorded combinations</h2>
                                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Each entry keeps its own chassis, engine and classification together.</p>
                            </div>
                            <table className="w-full text-left text-sm">
                                <thead className="text-xs text-gray-500 dark:text-slate-400"><tr>
                                    <th className="px-4 py-3">Engine</th><th className="px-4 py-3">Chassis</th><th className="px-4 py-3">Years</th><th className="px-4 py-3">Classification</th><th className="px-4 py-3 text-right">{canEdit ? 'Actions' : 'Linked parts'}</th>
                                </tr></thead>
                                <tbody>{rows.map(app => (
                                    <tr key={app.application_id} className="border-t border-gray-100 text-gray-700 dark:border-slate-700 dark:text-slate-300">
                                        <td className="px-4 py-3 font-mono"><EngineCodeText codes={app.engine} /></td>
                                        <td className="px-4 py-3 font-mono">{app.chassis}</td>
                                        <td className="whitespace-nowrap px-4 py-3">{formatYearRange(app.year_start, app.year_end)}</td>
                                        <td className="px-4 py-3 text-xs leading-5">{formatQualifierSummary({ ...app, chassis: null })}</td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                <span className="whitespace-nowrap text-xs text-gray-500">{app.linked_parts_count || 0} linked</span>
                                                {canEdit && <>
                                                    <button type="button" onClick={() => onEdit(app)} aria-label={`Edit combination ${app.application_id}`} title="Edit combination" className="rounded p-1 text-primary-600 hover:bg-primary-50"><Icon path={ICONS.edit} className="h-4 w-4" /></button>
                                                    <button type="button" onClick={() => onDelete(app.application_id)} aria-label={`Delete combination ${app.application_id}`} title="Delete combination" className="rounded p-1 text-red-600 hover:bg-red-50"><Icon path={ICONS.trash} className="h-4 w-4" /></button>
                                                </>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
