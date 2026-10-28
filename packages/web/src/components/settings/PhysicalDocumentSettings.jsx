import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import ReceiptMonitor from './ReceiptMonitor';
import { ICONS } from '../../constants';

export default function PhysicalDocumentSettings() {
    const [subTab, setSubTab] = useState('types'); // 'types' | 'series' | 'policies' | 'spoilage'
    const [loading, setLoading] = useState(true);

    // Master data
    const [types, setTypes] = useState([]);
    const [seriesList, setSeriesList] = useState([]);
    const [policies, setPolicies] = useState([]);
    const [taxRates, setTaxRates] = useState([]);

    // Spoilage state
    const [spoilageRows, setSpoilageRows] = useState([]);
    const [spoilageTotal, setSpoilageTotal] = useState(0);
    const [spoilagePage, setSpoilagePage] = useState(1);
    const [spoilageSearch, setSpoilageSearch] = useState('');
    const [spoilageSeries, setSpoilageSeries] = useState('');
    const [spoilageFrom, setSpoilageFrom] = useState('');
    const [spoilageTo, setSpoilageTo] = useState('');
    const [spoilageSort, setSpoilageSort] = useState({ field: 'recorded_at', direction: 'desc' });
    const spoilageRequest = useRef(0);

    // Modals
    const [typeModalOpen, setTypeModalOpen] = useState(false);
    const [editingType, setEditingType] = useState(null);
    const [seriesModalOpen, setSeriesModalOpen] = useState(false);
    const [editingSeries, setEditingSeries] = useState(null);
    const [sequenceModalOpen, setSequenceModalOpen] = useState(false);
    const [sequenceSeries, setSequenceSeries] = useState(null);
    const [spoilModalOpen, setSpoilModalOpen] = useState(false);
    const [correctModalOpen, setCorrectModalOpen] = useState(false);
    const [correctingRecord, setCorrectingRecord] = useState(null);
    const [spoilTarget, setSpoilTarget] = useState(null);
    const [monitorRefresh, setMonitorRefresh] = useState(0);

    // Load initial data
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [typesRes, seriesRes, polRes, taxRes] = await Promise.all([
                api.get('/settings/physical-document-types'),
                api.get('/settings/physical-document-series'),
                api.get('/settings/physical-document-selection-policies'),
                api.get('/tax-rates'),
            ]);
            setTypes(typesRes.data);
            setSeriesList(seriesRes.data);
            setPolicies(polRes.data);
            setTaxRates(taxRes.data);
        } catch (err) {
            console.error('Failed to load physical document settings:', err);
            toast.error('Failed to load physical document settings.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadSpoilage = useCallback(async () => {
        const requestId = ++spoilageRequest.current;
        try {
            const res = await api.get('/settings/physical-document-spoilage', {
                params: { page: spoilagePage, pageSize: 10, search: spoilageSearch || undefined,
                    series_id: spoilageSeries || undefined, date_from: spoilageFrom || undefined,
                    date_to: spoilageTo || undefined, sortBy: spoilageSort.field, sortOrder: spoilageSort.direction }
            });
            if (requestId !== spoilageRequest.current) return;
            setSpoilageRows(res.data.items || res.data.data || []);
            setSpoilageTotal(res.data.total || 0);
        } catch (err) {
            if (requestId !== spoilageRequest.current) return;
            console.error('Failed to load spoilage:', err);
            toast.error('Failed to load spoiled receipts.');
        }
    }, [spoilagePage, spoilageSearch, spoilageSeries, spoilageFrom, spoilageTo, spoilageSort]);

    const sortSpoilage = (field) => {
        setSpoilageSort(current => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
        setSpoilagePage(1);
    };

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        if (subTab === 'spoilage') {
            loadSpoilage();
        }
    }, [subTab, loadSpoilage]);

    const handleToggleTypeActive = async (typeItem) => {
        try {
            await api.patch(`/settings/physical-document-types/${typeItem.type_id}`, {
                is_active: !typeItem.is_active,
            });
            toast.success(`Document type "${typeItem.name}" ${!typeItem.is_active ? 'activated' : 'deactivated'}.`);
            loadData();
        } catch (err) {
            console.error('Failed to toggle type active state:', err);
            toast.error(err.response?.data?.message || 'Failed to update document type.');
        }
    };

    const handleDeleteType = async (typeItem) => {
        const seriesCount = parseInt(typeItem.series_count || 0, 10);
        const confirmMsg = seriesCount > 0
            ? `Document type "${typeItem.name}" is used by ${seriesCount} series and cannot be permanently deleted. Do you want to deactivate it instead?`
            : `Are you sure you want to permanently delete document type "${typeItem.name}"?`;

        if (!window.confirm(confirmMsg)) return;

        try {
            const res = await api.delete(`/settings/physical-document-types/${typeItem.type_id}`);
            toast.success(res.data?.message || 'Document type updated.');
            loadData();
        } catch (err) {
            console.error('Failed to delete/deactivate document type:', err);
            toast.error(err.response?.data?.message || 'Failed to delete document type.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-200 dark:border-slate-700 pb-4">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                        Physical Documents & Types
                        <InfoTip label="Physical Documents">
                            Configure document types (Sales Invoices, Delivery Receipts, Collection Receipts, Notebooks, Custom types), paper receipt series, suggestion methods, tax rate linkages, and cashier pre-selection policies.
                        </InfoTip>
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        All cashier dropdown choices are dynamically driven by these settings with zero hardcoded options, and automatically default to the cashier's last used type on each page.
                    </p>
                </div>
                <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                    <button
                        type="button"
                        onClick={() => setSubTab('types')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${subTab === 'types' ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-xs' : 'text-gray-600 dark:text-slate-400'}`}
                    >
                        Document Types
                    </button>
                    <button
                        type="button"
                        onClick={() => setSubTab('series')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${subTab === 'series' ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-xs' : 'text-gray-600 dark:text-slate-400'}`}
                    >
                        Series
                    </button>
                    <button
                        type="button"
                        onClick={() => setSubTab('policies')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${subTab === 'policies' ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-xs' : 'text-gray-600 dark:text-slate-400'}`}
                    >
                        Selection Policies
                    </button>
                    <button type="button" onClick={() => setSubTab('monitor')} className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${subTab === 'monitor' ? 'bg-white dark:bg-slate-900 text-primary-600 shadow-xs' : 'text-gray-600 dark:text-slate-400'}`}>Series Monitor</button>
                    <button
                        type="button"
                        onClick={() => setSubTab('spoilage')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${subTab === 'spoilage' ? 'bg-white dark:bg-slate-900 text-primary-600 dark:text-primary-400 shadow-xs' : 'text-gray-600 dark:text-slate-400'}`}
                    >
                        Spoiled Paper
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading document configuration...</div>
            ) : (
                <>
                    {/* TAB 0: DOCUMENT TYPES */}
                    {subTab === 'types' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500 dark:text-slate-400">
                                    {types.length} configured document types
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingType(null);
                                        setTypeModalOpen(true);
                                    }}
                                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition"
                                >
                                    <Icon path={ICONS.plus} className="w-3.5 h-3.5" />
                                    Add Document Type
                                </button>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50 dark:bg-slate-800/80 text-gray-600 dark:text-slate-300 border-b border-gray-200 dark:border-slate-700 uppercase font-semibold">
                                        <tr>
                                            <th className="px-4 py-3">Short Label / Code</th>
                                            <th className="px-4 py-3">Type Name</th>
                                            <th className="px-4 py-3">Category</th>
                                            <th className="px-4 py-3">Tax Designation</th>
                                            <th className="px-4 py-3">Default Method</th>
                                            <th className="px-4 py-3">Series Count</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60 font-sans">
                                        {types.length === 0 ? (
                                            <tr>
                                                <td colSpan="8" className="px-4 py-8 text-center text-gray-500">
                                                    No document types configured. Click "Add Document Type" to create one.
                                                </td>
                                            </tr>
                                        ) : (
                                            types.map(t => (
                                                <tr key={t.type_id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-slate-100">
                                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 text-primary-700 dark:text-primary-300">
                                                            {t.short_label}
                                                        </span>
                                                        <span className="ml-2 font-normal text-gray-500 text-[11px]">
                                                            {t.code}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                                                        {t.name}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 font-semibold">
                                                            {t.controlled_category}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${t.tax_designation === 'VAT' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                                                            {t.tax_designation}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                                                        {t.default_method === 'HIGHEST_PLUS_ONE' ? 'Highest + 1' : (t.default_method === 'LAST_ISSUED_PLUS_ONE' ? 'Last Issued + 1' : 'None')}
                                                    </td>
                                                    <td className="px-4 py-3 font-mono text-gray-700 dark:text-slate-300">
                                                        {t.series_count || 0}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleTypeActive(t)}
                                                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition cursor-pointer ${t.is_active ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 hover:bg-gray-200'}`}
                                                            title="Click to toggle active status"
                                                        >
                                                            {t.is_active ? 'Active' : 'Inactive'}
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-3 text-right space-x-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingType(t);
                                                                setTypeModalOpen(true);
                                                            }}
                                                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteType(t)}
                                                            className="text-xs font-semibold text-danger-600 hover:text-danger-700 dark:text-danger-400"
                                                        >
                                                            {parseInt(t.series_count || 0, 10) > 0 ? (t.is_active ? 'Deactivate' : 'Disabled') : 'Delete'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 1: SERIES LIST */}
                    {subTab === 'series' && (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500 dark:text-slate-400">
                                    {seriesList.length} configured physical series
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingSeries(null);
                                        setSeriesModalOpen(true);
                                    }}
                                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition"
                                >
                                    <Icon path={ICONS.plus} className="w-3.5 h-3.5" />
                                    Add New Series
                                </button>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50 dark:bg-slate-800/80 text-gray-600 dark:text-slate-300 border-b border-gray-200 dark:border-slate-700 uppercase font-semibold">
                                        <tr>
                                            <th className="px-4 py-3">Prefix / Short</th>
                                            <th className="px-4 py-3">Series Name</th>
                                            <th className="px-4 py-3">Category / Tax</th>
                                            <th className="px-4 py-3">Method</th>
                                            <th className="px-4 py-3">Next / Counter</th>
                                            <th className="px-4 py-3">Contexts</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60 font-mono">
                                        {seriesList.length === 0 ? (
                                            <tr>
                                                <td colSpan="8" className="px-4 py-8 text-center text-gray-500 font-sans">
                                                    No physical document series configured. Click "Add New Series" to set up your paper receipt booklets.
                                                </td>
                                            </tr>
                                        ) : (
                                            seriesList.map(s => (
                                                <tr key={s.series_id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3 font-bold text-gray-900 dark:text-slate-100">
                                                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-700 text-primary-700 dark:text-primary-300">
                                                            {s.prefix}
                                                        </span>
                                                        <span className="ml-2 font-sans font-normal text-gray-500">
                                                            ({s.short_label})
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-sans font-medium text-gray-900 dark:text-slate-100">
                                                        {s.name}
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-gray-600 dark:text-slate-300">
                                                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 mr-1.5 font-semibold">
                                                            {s.controlled_category}
                                                        </span>
                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.tax_designation === 'VAT' ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                                                            {s.tax_designation}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-xs text-gray-600 dark:text-slate-400">
                                                        {s.method === 'HIGHEST_PLUS_ONE' ? 'Highest + 1' : (s.method === 'LAST_ISSUED_PLUS_ONE' ? 'Last Issued + 1' : 'None')}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs">
                                                        <div>High: {s.high_water_serial || '—'}</div>
                                                        <div className="text-gray-500">Last: {s.last_issued_serial || '—'}</div>
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-[11px] text-gray-600 dark:text-slate-400">
                                                        {s.contexts?.map(c => c.context).join(', ') || 'None'}
                                                    </td>
                                                    <td className="px-4 py-3 font-sans">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.is_active ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-slate-800 text-gray-500'}`}>
                                                            {s.is_active ? 'Active' : 'Inactive'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-sans space-x-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSequenceSeries(s);
                                                                setSequenceModalOpen(true);
                                                            }}
                                                            className="text-xs font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400"
                                                            title="Audited sequence counter adjustment"
                                                        >
                                                            Adjust
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setEditingSeries(s);
                                                                setSeriesModalOpen(true);
                                                            }}
                                                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400"
                                                        >
                                                            Edit
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: SELECTION POLICIES */}
                    {subTab === 'policies' && (
                        <PolicySettingsTab
                            policies={policies}
                            seriesList={seriesList}
                            onSaved={loadData}
                        />
                    )}

                    {subTab === 'monitor' && <ReceiptMonitor seriesList={seriesList} refresh={monitorRefresh} onSpoil={target => { setSpoilTarget(target); setSpoilModalOpen(true); }} onCorrect={record => { setCorrectingRecord(record); setCorrectModalOpen(true); }} />}

                    {/* TAB 3: SPOILED NUMBERS & HISTORY */}
                    {subTab === 'spoilage' && (
                        <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                <div className="w-full sm:w-64">
                                    <input
                                        type="text"
                                        placeholder="Search reference, actor, reason..."
                                        aria-label="Search spoiled receipts"
                                        value={spoilageSearch}
                                        onChange={(e) => {
                                            setSpoilageSearch(e.target.value);
                                            setSpoilagePage(1);
                                        }}
                                        className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { setSpoilTarget(null); setSpoilModalOpen(true); }}
                                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                                >
                                    <Icon path={ICONS.plus} className="w-3.5 h-3.5" />
                                    Mark Spoiled Number
                                </button>
                            </div>

                            <div className="flex flex-wrap items-end gap-3 text-xs">
                                <label className="flex flex-col gap-1">Series
                                    <select value={spoilageSeries} onChange={e => { setSpoilageSeries(e.target.value); setSpoilagePage(1); }} className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5">
                                        <option value="">All series</option>
                                        {seriesList.map(series => <option key={series.series_id} value={series.series_id}>{series.name} ({series.prefix})</option>)}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1">From date
                                    <input type="date" value={spoilageFrom} max={spoilageTo || undefined} onChange={e => { setSpoilageFrom(e.target.value); setSpoilagePage(1); }} className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5" />
                                </label>
                                <label className="flex flex-col gap-1">To date
                                    <input type="date" value={spoilageTo} min={spoilageFrom || undefined} onChange={e => { setSpoilageTo(e.target.value); setSpoilagePage(1); }} className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5" />
                                </label>
                                <button type="button" onClick={() => { setSpoilageSearch(''); setSpoilageSeries(''); setSpoilageFrom(''); setSpoilageTo(''); setSpoilagePage(1); }} className="px-3 py-1.5 text-primary-600 dark:text-primary-400">Clear filters</button>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50 dark:bg-slate-800/80 text-gray-600 dark:text-slate-300 border-b border-gray-200 dark:border-slate-700 uppercase font-semibold">
                                        <tr>
                                            {[[ 'reference', 'Reference' ], [ 'series', 'Series' ], [ 'recorded_at', 'Recorded At' ], [ 'actor', 'Actor' ], [ 'reason', 'Reason / Notes' ]].map(([field, label]) => (
                                                <th key={field} className="px-4 py-3" aria-sort={spoilageSort.field === field ? (spoilageSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                                    <button type="button" onClick={() => sortSpoilage(field)} className="whitespace-nowrap">{label} {spoilageSort.field === field ? (spoilageSort.direction === 'asc' ? '↑' : '↓') : '↕'}</button>
                                                </th>
                                            ))}
                                            <th className="px-4 py-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60 font-mono">
                                        {spoilageRows.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="px-4 py-8 text-center text-gray-500 font-sans">
                                                    No spoiled receipts match the current filters.
                                                </td>
                                            </tr>
                                        ) : (
                                            spoilageRows.map(r => (
                                                <tr key={r.registry_id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-3 font-bold text-amber-700 dark:text-amber-300">
                                                        {r.canonical_full_reference}
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-gray-800 dark:text-slate-200">
                                                        {r.series_name} ({r.prefix})
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-500">
                                                        {new Date(r.spoiled_at).toLocaleString(undefined, { timeZone: 'Asia/Manila' })}
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-gray-700 dark:text-slate-300">
                                                        {r.actor_name || 'System / Cashier'}
                                                    </td>
                                                    <td className="px-4 py-3 font-sans text-gray-600 dark:text-slate-400">
                                                        <div className="font-semibold text-gray-800 dark:text-slate-200">
                                                            {r.spoilage_reason || 'Spoiled'}
                                                        </div>
                                                        {r.spoilage_notes && (
                                                            <div className="text-[11px] text-gray-500 italic">{r.spoilage_notes}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-sans">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setCorrectingRecord(r);
                                                                setCorrectModalOpen(true);
                                                            }}
                                                            className="text-xs font-semibold text-danger-600 hover:text-danger-700 dark:text-danger-400"
                                                        >
                                                            Correct / Unspoil
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-400">
                                <span>{spoilageTotal} spoiled receipt{spoilageTotal === 1 ? '' : 's'}</span>
                                <div className="flex items-center gap-3">
                                    <button type="button" disabled={spoilagePage <= 1} onClick={() => setSpoilagePage(page => page - 1)} className="disabled:opacity-40">Previous</button>
                                    <span>Page {spoilagePage} of {Math.max(1, Math.ceil(spoilageTotal / 10))}</span>
                                    <button type="button" disabled={spoilagePage * 10 >= spoilageTotal} onClick={() => setSpoilagePage(page => page + 1)} className="disabled:opacity-40">Next</button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* MODAL: DOCUMENT TYPE EDITOR */}
            <Modal
                isOpen={typeModalOpen}
                onClose={() => setTypeModalOpen(false)}
                title={editingType ? `Edit Document Type: ${editingType.name}` : 'Create Document Type'}
            >
                <DocumentTypeEditorForm
                    typeItem={editingType}
                    onSaved={() => {
                        setTypeModalOpen(false);
                        loadData();
                    }}
                    onCancel={() => setTypeModalOpen(false)}
                />
            </Modal>

            {/* MODAL: SERIES EDITOR */}
            <Modal
                isOpen={seriesModalOpen}
                onClose={() => setSeriesModalOpen(false)}
                title={editingSeries ? `Edit Series: ${editingSeries.name}` : 'Create Physical Document Series'}
            >
                <SeriesEditorForm
                    series={editingSeries}
                    types={types}
                    taxRates={taxRates}
                    onSaved={() => {
                        setSeriesModalOpen(false);
                        loadData();
                    }}
                    onCancel={() => setSeriesModalOpen(false)}
                />
            </Modal>

            {/* MODAL: ADJUST SEQUENCE */}
            <Modal
                isOpen={sequenceModalOpen}
                onClose={() => setSequenceModalOpen(false)}
                title={`Adjust Sequence: ${sequenceSeries?.name || ''}`}
            >
                <SequenceAdjustForm
                    series={sequenceSeries}
                    onSaved={() => {
                        setSequenceModalOpen(false);
                        loadData();
                    }}
                    onCancel={() => setSequenceModalOpen(false)}
                />
            </Modal>

            {/* MODAL: MARK SPOILED */}
            <Modal
                isOpen={spoilModalOpen}
                onClose={() => setSpoilModalOpen(false)}
                title="Record Spoiled Receipt Number"
            >
                <SpoilForm
                    key={spoilTarget?.reference || 'new'}
                    seriesList={seriesList}
                    initialTarget={spoilTarget}
                    onSaved={() => {
                        setSpoilModalOpen(false);
                        setMonitorRefresh(value => value + 1);
                        loadSpoilage();
                    }}
                    onCancel={() => setSpoilModalOpen(false)}
                />
            </Modal>

            {/* MODAL: CORRECT SPOILAGE */}
            <Modal
                isOpen={correctModalOpen}
                onClose={() => setCorrectModalOpen(false)}
                title={`Correct Spoiled Reference: ${correctingRecord?.canonical_full_reference || ''}`}
            >
                <CorrectSpoilForm
                    record={correctingRecord}
                    onSaved={() => {
                        setCorrectModalOpen(false);
                        setMonitorRefresh(value => value + 1);
                        loadSpoilage();
                    }}
                    onCancel={() => setCorrectModalOpen(false)}
                />
            </Modal>
        </div>
    );
}

// Subcomponent: Selection Policies Tab
function PolicySettingsTab({ policies, seriesList, onSaved }) {
    const contexts = [
        { code: 'POS', name: 'Direct POS Checkout' },
        { code: 'INVOICING', name: 'Direct Invoicing Page' },
        { code: 'CASHIER_APPROVAL', name: 'Cashier Approval Desk' },
        { code: 'COLLECTION', name: 'Receive Payment / Collection' },
    ];

    const [formValues, setFormValues] = useState({});

    useEffect(() => {
        const initial = {};
        for (const ctx of contexts) {
            const found = policies.find(p => p.context === ctx.code && (!p.workstation_id || p.workstation_id === ''));
            initial[ctx.code] = {
                mode: found?.mode || 'LAST_SUCCESSFUL',
                fixed_or_fallback_series_id: found?.fixed_or_fallback_series_id || '',
                allow_notebook: found?.allow_notebook !== false,
                expected_version: found?.version || 1,
            };
        }
        setFormValues(initial);
    }, [policies]);

    const handleSavePolicy = async (contextCode) => {
        const p = formValues[contextCode];
        if (!p) return;

        try {
            await api.put('/settings/physical-document-selection-policies', {
                context: contextCode,
                mode: p.mode,
                fixed_or_fallback_series_id: p.fixed_or_fallback_series_id ? parseInt(p.fixed_or_fallback_series_id, 10) : null,
                allow_notebook: p.allow_notebook,
                expected_version: p.expected_version,
            });
            toast.success(`Policy saved for ${contextCode}!`);
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save selection policy.');
        }
    };

    return (
        <div className="space-y-6">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-gray-600 dark:text-slate-300">
                <strong>Selection Policy Rules:</strong>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li><strong>Last successfully issued:</strong> Remembers the last successfully issued paper series per cashier on this workstation. Notebook is an explicit choice and is never remembered as default.</li>
                    <li><strong>Fixed default:</strong> Always starts a new sale with the chosen default paper series.</li>
                    <li><strong>Always ask:</strong> Pristine forms start unselected, forcing explicit cashier selection.</li>
                </ul>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contexts.map(ctx => {
                    const current = formValues[ctx.code] || { mode: 'LAST_SUCCESSFUL', fixed_or_fallback_series_id: '', allow_notebook: true };
                    return (
                        <div key={ctx.code} className="p-4 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 space-y-3">
                            <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-2">
                                <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">{ctx.name}</h3>
                                <span className="font-mono text-xs text-gray-400">{ctx.code}</span>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                                    Document Selection Mode
                                </label>
                                <select
                                    value={current.mode}
                                    onChange={(e) => {
                                        const newMode = e.target.value;
                                        setFormValues(prev => ({
                                            ...prev,
                                            [ctx.code]: { ...prev[ctx.code], mode: newMode }
                                        }));
                                    }}
                                    className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-medium"
                                >
                                    <option value="LAST_SUCCESSFUL">Last successfully issued (Recommended)</option>
                                    <option value="FIXED_DEFAULT">Fixed default</option>
                                    <option value="ALWAYS_ASK">Always ask (Pristine start)</option>
                                </select>
                            </div>

                            {current.mode !== 'ALWAYS_ASK' && (
                                <div>
                                    <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1">
                                        {current.mode === 'FIXED_DEFAULT' ? 'Fixed Default Series' : 'Fallback Series (if no prior success)'}
                                    </label>
                                    <select
                                        value={current.fixed_or_fallback_series_id}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setFormValues(prev => ({
                                                ...prev,
                                                [ctx.code]: { ...prev[ctx.code], fixed_or_fallback_series_id: val }
                                            }));
                                        }}
                                        className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-medium"
                                    >
                                        <option value="">{current.mode === 'FIXED_DEFAULT' ? 'Select default series...' : 'None (ask if no prior success)'}</option>
                                        {seriesList.map(s => (
                                            <option key={s.series_id} value={s.series_id}>
                                                {s.name} ({s.prefix})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <label className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-slate-300 pt-1">
                                <input
                                    type="checkbox"
                                    checked={current.allow_notebook}
                                    onChange={(e) => {
                                        const chk = e.target.checked;
                                        setFormValues(prev => ({
                                            ...prev,
                                            [ctx.code]: { ...prev[ctx.code], allow_notebook: chk }
                                        }));
                                    }}
                                    className="rounded text-primary-600 focus:ring-primary-500"
                                />
                                Allow Notebook (No physical paper receipt)
                            </label>

                            <div className="pt-2 flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => handleSavePolicy(ctx.code)}
                                    className="px-3 py-1 bg-primary-600 text-white rounded text-xs font-semibold hover:bg-primary-700 transition"
                                >
                                    Save Policy
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Subcomponent: Series Editor Form
function SeriesEditorForm({ series, types, taxRates, onSaved, onCancel }) {
    const isEdit = !!series;
    const [formData, setFormData] = useState({
        type_id: series?.type_id || (types[0]?.type_id || ''),
        code: series?.code || '',
        name: series?.name || '',
        prefix: series?.prefix || '',
        method: series?.method || 'HIGHEST_PLUS_ONE',
        initial_serial: series?.initial_serial || 1,
        min_serial: series?.min_serial || '',
        max_serial: series?.max_serial || '',
        is_active: series?.is_active !== false,
        contexts: series?.contexts?.map(c => c.context) || ['POS', 'INVOICING', 'CASHIER_APPROVAL'],
        default_fallback_tax_id: series?.tax_mappings?.find(t => t.role === 'DEFAULT_FALLBACK')?.tax_rate_id || '',
        allowed_tax_ids: series?.tax_mappings?.map(t => t.tax_rate_id) || [],
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const taxMappings = [];
            if (formData.default_fallback_tax_id) {
                taxMappings.push({
                    tax_rate_id: parseInt(formData.default_fallback_tax_id, 10),
                    role: 'DEFAULT_FALLBACK'
                });
            }
            for (const tid of formData.allowed_tax_ids) {
                if (tid !== parseInt(formData.default_fallback_tax_id, 10)) {
                    taxMappings.push({ tax_rate_id: tid, role: 'ALLOWED_RESOLVED' });
                }
            }

            if (isEdit) {
                await api.patch(`/settings/physical-document-series/${series.series_id}`, {
                    name: formData.name,
                    method: formData.method,
                    min_serial: formData.min_serial ? parseInt(formData.min_serial, 10) : null,
                    max_serial: formData.max_serial ? parseInt(formData.max_serial, 10) : null,
                    is_active: formData.is_active,
                    contexts: formData.contexts,
                    tax_mappings: taxMappings,
                    expected_version: series.version,
                });
                toast.success('Series updated successfully!');
            } else {
                await api.post('/settings/physical-document-series', {
                    ...formData,
                    tax_mappings: taxMappings,
                });
                toast.success('Series created successfully!');
            }
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save series.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Document Type</label>
                    <select
                        value={formData.type_id}
                        disabled={isEdit}
                        onChange={(e) => setFormData(prev => ({ ...prev, type_id: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        {types.map(t => (
                            <option key={t.type_id} value={t.type_id}>
                                {t.name} ({t.tax_designation})
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Prefix</label>
                    <input
                        type="text"
                        disabled={isEdit}
                        value={formData.prefix}
                        onChange={(e) => setFormData(prev => ({ ...prev, prefix: e.target.value.toUpperCase() }))}
                        placeholder="e.g. SI, DR, CR"
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono font-bold"
                        required
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Series Code</label>
                    <input
                        type="text"
                        disabled={isEdit}
                        value={formData.code}
                        onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        placeholder="e.g. SI_2026_VAT"
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                        required
                    />
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Series Name</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Main Sales Invoice Booklets"
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-medium"
                        required
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Suggestion Method</label>
                    <select
                        value={formData.method}
                        onChange={(e) => setFormData(prev => ({ ...prev, method: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        <option value="HIGHEST_PLUS_ONE">Highest + 1 (Continuous)</option>
                        <option value="LAST_ISSUED_PLUS_ONE">Last Issued + 1 (Discontinuous)</option>
                        <option value="NONE">None</option>
                    </select>
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Min Serial</label>
                    <input
                        type="number"
                        value={formData.min_serial}
                        onChange={(e) => setFormData(prev => ({ ...prev, min_serial: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                    />
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Max Serial</label>
                    <input
                        type="number"
                        value={formData.max_serial}
                        onChange={(e) => setFormData(prev => ({ ...prev, max_serial: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                    />
                </div>
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Allowed Workflows</label>
                <div className="grid grid-cols-2 gap-2 p-2 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                    {['POS', 'INVOICING', 'CASHIER_APPROVAL', 'COLLECTION'].map(ctx => (
                        <label key={ctx} className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.contexts.includes(ctx)}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFormData(prev => ({
                                        ...prev,
                                        contexts: checked ? [...prev.contexts, ctx] : prev.contexts.filter(c => c !== ctx)
                                    }));
                                }}
                                className="rounded text-primary-600 focus:ring-primary-500"
                            />
                            <span>{ctx}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Default Fallback Tax Rate</label>
                    <select
                        value={formData.default_fallback_tax_id}
                        onChange={(e) => setFormData(prev => ({ ...prev, default_fallback_tax_id: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        <option value="">None / Unmapped</option>
                        {taxRates.map(tr => (
                            <option key={tr.tax_rate_id} value={tr.tax_rate_id}>
                                {tr.rate_name} ({(tr.rate_percentage * 100).toFixed(0)}%)
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.is_active}
                            onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                            className="rounded text-primary-600 focus:ring-primary-500"
                        />
                        <span className="font-semibold text-gray-900 dark:text-slate-100">Series is Active</span>
                    </label>
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 bg-primary-600 text-white rounded-md text-xs font-semibold hover:bg-primary-700"
                >
                    {submitting ? 'Saving...' : 'Save Series'}
                </button>
            </div>
        </form>
    );
}

// Subcomponent: Audited Sequence Adjustment Form
function SequenceAdjustForm({ series, onSaved, onCancel }) {
    const [highWater, setHighWater] = useState(series?.high_water_serial || '');
    const [lastIssued, setLastIssued] = useState(series?.last_issued_serial || '');
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!reason.trim()) {
            toast.error('Audit reason is required for sequence adjustment.');
            return;
        }

        setSubmitting(true);
        try {
            await api.post(`/settings/physical-document-series/${series.series_id}/adjust-sequence`, {
                expected_version: series.version,
                high_water_serial: highWater ? parseInt(highWater, 10) : null,
                last_issued_serial: lastIssued ? parseInt(lastIssued, 10) : null,
                reason,
                notes,
            });
            toast.success('Sequence counter adjusted and audited!');
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to adjust sequence.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
                <strong>Audited Action:</strong> Sequence adjustments modify where auto-suggestions continue from without erasing or re-issuing occupied registry numbers. All adjustments are logged with your user identity and timestamp.
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">High Water Serial</label>
                    <input
                        type="number"
                        value={highWater}
                        onChange={(e) => setHighWater(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                    />
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Last Issued Serial</label>
                    <input
                        type="number"
                        value={lastIssued}
                        onChange={(e) => setLastIssued(e.target.value)}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                    />
                </div>
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Reason for Adjustment *</label>
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Switched to Booklet #4 (serial range 3001-3100)"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-medium"
                    required
                />
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Additional Notes</label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows="2"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-semibold"
                >
                    {submitting ? 'Adjusting...' : 'Confirm Adjustment'}
                </button>
            </div>
        </form>
    );
}

// Subcomponent: Manual Spoil Form
function SpoilForm({ seriesList, initialTarget, onSaved, onCancel }) {
    const [seriesId, setSeriesId] = useState(initialTarget?.series_id || seriesList[0]?.series_id || '');
    const [receiptNo, setReceiptNo] = useState(initialTarget?.reference || '');
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/settings/physical-document-spoilage', {
                series_id: parseInt(seriesId, 10),
                physical_receipt_no: receiptNo,
                reason,
                notes,
            });
            toast.success('Spoilage recorded successfully!');
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to record spoilage.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Series</label>
                <select
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                    {seriesList.map(s => (
                        <option key={s.series_id} value={s.series_id}>
                            {s.name} ({s.prefix})
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Physical Receipt Number</label>
                <input
                    type="text"
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.target.value)}
                    placeholder="e.g. SI-1234"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono"
                    required
                />
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Reason for Spoilage *</label>
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Torn stub, ink bleed, damaged paper"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    required
                />
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Optional Notes</label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows="2"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-semibold"
                >
                    {submitting ? 'Recording...' : 'Record Spoilage'}
                </button>
            </div>
        </form>
    );
}

// Subcomponent: Correct Spoilage Form
function CorrectSpoilForm({ record, onSaved, onCancel }) {
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!reason.trim()) {
            toast.error('Reason is required to correct spoilage.');
            return;
        }

        setSubmitting(true);
        try {
            await api.post(`/settings/physical-document-spoilage/${record.registry_id}/correct`, {
                reason,
                expected_version: record.version,
            });
            toast.success('Spoilage corrected! Reference is now eligible for issuance.');
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to correct spoilage.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <p className="text-gray-600 dark:text-slate-300">
                Are you sure you want to correct the mistaken spoilage of <strong>{record?.canonical_full_reference}</strong>? This will make the receipt number available for issuance again without rewinding sequence pointers.
            </p>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">Reason for Correction *</label>
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Paper inspected, verified undamaged and ready for issuance"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    required
                />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 bg-danger-600 hover:bg-danger-700 text-white rounded-md text-xs font-semibold"
                >
                    {submitting ? 'Correcting...' : 'Confirm Correction'}
                </button>
            </div>
        </form>
    );
}

// Subcomponent: Document Type Editor Form
function DocumentTypeEditorForm({ typeItem, onSaved, onCancel }) {
    const isEdit = !!typeItem;
    const [formData, setFormData] = useState({
        code: typeItem?.code || '',
        name: typeItem?.name || '',
        short_label: typeItem?.short_label || '',
        controlled_category: typeItem?.controlled_category || 'SALES_INVOICE',
        tax_designation: typeItem?.tax_designation || 'VAT',
        default_method: typeItem?.default_method || 'HIGHEST_PLUS_ONE',
        is_active: typeItem?.is_active !== false,
    });
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (isEdit) {
                await api.patch(`/settings/physical-document-types/${typeItem.type_id}`, {
                    name: formData.name,
                    short_label: formData.short_label,
                    controlled_category: formData.controlled_category,
                    tax_designation: formData.tax_designation,
                    default_method: formData.default_method,
                    is_active: formData.is_active,
                });
                toast.success('Document type updated successfully!');
            } else {
                await api.post('/settings/physical-document-types', formData);
                toast.success('Document type created successfully!');
            }
            onSaved?.();
        } catch (err) {
            console.error('Failed to save document type:', err);
            toast.error(err.response?.data?.message || 'Failed to save document type.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        Type Code *
                    </label>
                    <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }))}
                        disabled={isEdit}
                        placeholder="e.g. SALES_INVOICE_VAT"
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 font-mono disabled:opacity-60"
                        required
                    />
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        Short Label *
                    </label>
                    <input
                        type="text"
                        value={formData.short_label}
                        onChange={(e) => setFormData(prev => ({ ...prev, short_label: e.target.value }))}
                        placeholder="e.g. SI VAT or Notebook"
                        maxLength={20}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                        required
                    />
                </div>
            </div>

            <div>
                <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                    Display Name *
                </label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Sales Invoice — VAT"
                    className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    required
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        Category
                    </label>
                    <select
                        value={formData.controlled_category}
                        onChange={(e) => setFormData(prev => ({ ...prev, controlled_category: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        <option value="SALES_INVOICE">SALES_INVOICE</option>
                        <option value="COLLECTION_RECEIPT">COLLECTION_RECEIPT</option>
                        <option value="DELIVERY_RECEIPT">DELIVERY_RECEIPT</option>
                        <option value="CHARGE_INVOICE">CHARGE_INVOICE</option>
                        <option value="OFFICIAL_RECEIPT">OFFICIAL_RECEIPT</option>
                        <option value="NOTEBOOK">NOTEBOOK</option>
                        <option value="OTHER">OTHER</option>
                    </select>
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        Tax Designation
                    </label>
                    <select
                        value={formData.tax_designation}
                        onChange={(e) => setFormData(prev => ({ ...prev, tax_designation: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        <option value="VAT">VAT</option>
                        <option value="NON_VAT">NON_VAT</option>
                        <option value="EXEMPT">EXEMPT</option>
                        <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
                    </select>
                </div>
                <div>
                    <label className="block font-semibold text-gray-700 dark:text-slate-300 mb-1">
                        Default Method
                    </label>
                    <select
                        value={formData.default_method}
                        onChange={(e) => setFormData(prev => ({ ...prev, default_method: e.target.value }))}
                        className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                    >
                        <option value="HIGHEST_PLUS_ONE">Highest + 1</option>
                        <option value="LAST_ISSUED_PLUS_ONE">Last Issued + 1</option>
                        <option value="NONE">None / Manual</option>
                    </select>
                </div>
            </div>

            <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                        className="rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span className="font-semibold text-gray-700 dark:text-slate-300">Active (Visible in selection options and series editor)</span>
                </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-md text-xs font-semibold transition"
                >
                    {submitting ? 'Saving...' : (isEdit ? 'Update Document Type' : 'Create Document Type')}
                </button>
            </div>
        </form>
    );
}
