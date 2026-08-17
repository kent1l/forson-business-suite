import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';
// eslint-disable-next-line no-unused-vars
import Icon from '../components/ui/Icon';
import Modal from '../components/ui/Modal';
import { ICONS } from '../constants';

const blankRow = () => ({ date: format(new Date(), 'yyyy-MM-dd'), payee: '', amount: '', memo: '' });

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700`;
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-primary-600 text-white hover:bg-primary-700`;
const BUTTON_DANGER = `${BUTTON_BASE} border border-danger-200 dark:border-danger-900/50 bg-white dark:bg-slate-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20`;
const INPUT_BASE = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/30';

const ChequePrintingPage = () => {
    const [templates, setTemplates] = useState([]);
    const [printerProfiles, setPrinterProfiles] = useState([]);
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [rows, setRows] = useState([blankRow()]);
    const [history, setHistory] = useState([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [persistRecords, setPersistRecords] = useState(true);
    const [testPrintMode, setTestPrintMode] = useState(false);
    const [historyQuery, setHistoryQuery] = useState('');
    const [historyBankFilter, setHistoryBankFilter] = useState('all');
    const [pendingHistoryEntry, setPendingHistoryEntry] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const selectedTemplate = useMemo(() => templates.find((tpl) => String(tpl.id) === String(selectedTemplateId)), [templates, selectedTemplateId]);

    const loadData = async () => {
        try {
            const [templatesRes, historyRes, profilesRes] = await Promise.all([api.get('/cheques/templates'), api.get('/cheques/history'), api.get('/cheques/printer-profiles')]);
            const templateRows = templatesRes.data || [];
            const profileRows = profilesRes.data || [];
            setTemplates(templateRows);
            setHistory(historyRes.data || []);
            setPrinterProfiles(profileRows);
            if (!selectedTemplateId && templateRows.length) setSelectedTemplateId(String(templateRows[0].id));
            if (!selectedProfileId && profileRows.length) {
                const defaultProfile = profileRows.find((profile) => profile.is_default) || profileRows[0];
                setSelectedProfileId(String(defaultProfile.id));
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to load cheque module.');
        }
    };

    useEffect(() => { loadData(); }, []);

    const updateRow = (idx, field, value) => {
        setRows((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            if (idx === next.length - 1 && (next[idx].payee || next[idx].amount || next[idx].memo)) {
                next.push(blankRow());
            }
            return next;
        });
    };

    const removeRow = (idx) => {
        setRows((prev) => {
            if (prev.length === 1) return [blankRow()];
            const next = prev.filter((_, rowIndex) => rowIndex !== idx);
            return next.length ? next : [blankRow()];
        });
    };

    const validateRow = (row) => {
        if (!row.payee.trim()) return 'Payee is required';
        const amount = Number(row.amount);
        if (Number.isNaN(amount)) return 'Amount must be numeric';
        if (!isValid(parseISO(row.date))) return 'Due date is invalid';
        return null;
    };

    const activeRows = rows.filter((row) => row.payee || row.amount || row.memo).map((row) => ({
        ...row,
        amount: String(Math.round(Number(row.amount || 0) * 100) / 100)
    }));

    const filteredHistory = useMemo(() => {
        const query = historyQuery.trim().toLowerCase();
        return history.filter((entry) => {
            const bank = entry.bank_preset || 'Unassigned';
            const matchesBank = historyBankFilter === 'all' || bank === historyBankFilter;
            if (!matchesBank) return false;
            if (!query) return true;
            return [entry.payee, entry.memo, bank, String(entry.amount)]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query));
        });
    }, [history, historyQuery, historyBankFilter]);

    const historyBankOptions = useMemo(() => {
        const banks = Array.from(new Set(history.map((entry) => entry.bank_preset).filter(Boolean)));
        return banks.sort((a, b) => a.localeCompare(b));
    }, [history]);

    const requestGeneratePdf = () => {
        if (!selectedTemplate) return toast.error('Select a bank preset first.');
        if (!activeRows.length) return toast.error('Add at least one cheque line.');
        for (const row of activeRows) {
            const validationError = validateRow(row);
            if (validationError) return toast.error(validationError);
        }
        setConfirmOpen(true);
    };

    const generatePdf = async (sourceRows = activeRows, persist = persistRecords) => {
        if (!selectedTemplate) return toast.error('Select a bank preset first.');
        if (!sourceRows.length) return toast.error('Add at least one cheque line.');

        for (const row of sourceRows) {
            const validationError = validateRow(row);
            if (validationError) return toast.error(validationError);
        }

        setSaving(true);
        try {
            const templateDateFormat = selectedTemplate.date_format || 'MM-dd-yyyy';
            const payloadRows = sourceRows.map((row) => ({
                ...row,
                date: format(parseISO(row.date), templateDateFormat)
            }));

            const pdfResponse = await api.post('/cheques/generate-pdf', {
                template_id: Number(selectedTemplateId),
                printer_profile_id: selectedProfileId ? Number(selectedProfileId) : null,
                test_print: testPrintMode,
                records: payloadRows
            }, {
                responseType: 'blob'
            });

            const renderer = pdfResponse?.headers?.['x-cheque-pdf-renderer'];
            const rendererWarning = pdfResponse?.headers?.['x-cheque-pdf-warning'];
            if (rendererWarning) {
                toast(rendererWarning, { icon: '⚠️', duration: 8000 });
            } else if (renderer === 'fallback') {
                toast('Fallback PDF renderer was used because pdf-lib is unavailable.', { icon: '⚠️' });
            }

            if (persist) {
                const dbPayloadRows = sourceRows.map((row) => ({
                    ...row,
                    payee: (row.payee || '').trim(),
                    memo: (row.memo || '').trim()
                }));
                await api.post('/cheques/records', {
                    template_id: Number(selectedTemplateId),
                    records: dbPayloadRows
                });
                toast.success('Cheque generated and saved to history.');
                setRows([blankRow()]);
                await loadData();
            }

            const pdfBlob = new Blob([pdfResponse.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(pdfBlob);
            const opened = window.open(url, '_blank', 'noopener,noreferrer');
            if (!opened) {
                toast.error('Popup blocked. Allow popups for this site, then try again.');
            } else {
                toast.success('PDF opened in a new tab. Print using 100% scale for correct alignment.');
            }

        } catch (error) {
            toast.error(error?.response?.data?.message || 'PDF generation failed.');
        } finally {
            setSaving(false);
        }
    };

    const handleReprint = async (entry) => {
        if (!selectedTemplate) return toast.error('Select a preset for reprint.');
        await generatePdf([{
            payee: entry.payee,
            amount: Number(entry.amount).toFixed(2),
            date: entry.cheque_date ? format(new Date(entry.cheque_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            memo: entry.memo || ''
        }], false);
    };

    const handleDelete = async (id) => {
        try {
            await api.delete(`/cheques/history/${id}`);
            toast.success('Record removed.');
            await loadData();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Delete failed.');
        }
    };

    const normalizeHistoryEntryToRow = (entry) => ({
        payee: entry.payee || '',
        amount: Number(entry.amount || 0).toFixed(2),
        date: entry.cheque_date ? format(new Date(entry.cheque_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
        memo: entry.memo || ''
    });

    const applyHistoryEntryToEditor = (entry, mode = 'overwrite') => {
        const nextRow = normalizeHistoryEntryToRow(entry);
        const currentRows = rows.filter((row) => row.payee || row.amount || row.memo);

        if (entry.template_id && templates.some((tpl) => String(tpl.id) === String(entry.template_id))) {
            setSelectedTemplateId(String(entry.template_id));
        }

        if (mode === 'append') {
            setRows([...currentRows, nextRow, blankRow()]);
        } else {
            setRows([nextRow, blankRow()]);
        }
        setPendingHistoryEntry(null);
        setHistoryOpen(false);
        toast.success(mode === 'append' ? 'History cheque appended to editor.' : 'History cheque loaded to editor.');
    };

    const handleEditFromHistory = (entry) => {
        const currentRows = rows.filter((row) => row.payee || row.amount || row.memo);
        if (currentRows.length) {
            setPendingHistoryEntry(entry);
            return;
        }
        applyHistoryEntryToEditor(entry, 'overwrite');
    };

    const onRowKeyDown = (event, rowIndex, fieldIndex) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const selector = `[data-row="${rowIndex}"][data-field-index="${fieldIndex + 1}"]`;
        const next = document.querySelector(selector);
        if (next) next.focus();
    };

    const queueCount = activeRows.length;
    const queueTotal = activeRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    return (
        <div className="space-y-4 pb-4">
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 md:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-slate-100">Print Cheques</h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Prepare cheques for printing and review printed cheque history. Bank presets and printer profiles live under Templates &amp; Settings.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className={BUTTON_SECONDARY} onClick={() => setHistoryOpen(true)}>
                            <Icon path={ICONS.history} className="h-4 w-4" />
                            View History
                        </button>
                        <button className={BUTTON_PRIMARY} disabled={saving} onClick={requestGeneratePdf}>
                            <Icon path={ICONS.receipt} className="h-4 w-4" />
                            {saving ? 'Generating…' : 'Generate PDF'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Print Queue</h2>
                        {queueCount > 0 && (
                            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                                {queueCount} cheque{queueCount === 1 ? '' : 's'} · <span className="font-semibold text-gray-700 dark:text-slate-300 font-mono">₱{queueTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </span>
                        )}
                    </div>
                    <div className="hidden md:grid grid-cols-[28px_120px_1fr_160px_1fr_80px] gap-3 px-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                        <span></span>
                        <span>Date</span>
                        <span>Payee</span>
                        <span>Amount</span>
                        <span>Memo</span>
                        <span className="text-right">Actions</span>
                    </div>

                    {rows.map((row, idx) => {
                        const isTrailingBlank = idx === rows.length - 1 && !row.payee && !row.amount && !row.memo;
                        return (
                            <div key={idx} className={`border rounded-xl p-3 grid grid-cols-1 md:grid-cols-[28px_120px_1fr_160px_1fr_80px] gap-3 md:items-center transition-colors ${isTrailingBlank ? 'border-dashed border-gray-300 dark:border-slate-700 bg-transparent' : 'border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/40'}`}>
                                <div className="hidden md:flex items-center justify-center">
                                    {!isTrailingBlank && (
                                        <span className="h-5 w-5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400 text-[11px] font-bold flex items-center justify-center">
                                            {idx + 1}
                                        </span>
                                    )}
                                </div>
                                {[
                                    { field: 'date', placeholder: 'Date' },
                                    { field: 'payee', placeholder: 'Payee' },
                                    { field: 'amount', placeholder: 'Amount' },
                                    { field: 'memo', placeholder: 'Memo' }
                                ].map((column, fieldIndex) => (
                                    <div key={column.field} className="space-y-1">
                                        <label className="md:hidden text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{column.placeholder}</label>
                                        {column.field === 'amount' ? (
                                            <div className="relative">
                                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500">₱</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    className={`${INPUT_BASE} pl-7 font-mono`}
                                                    value={row.amount}
                                                    onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                                                    onKeyDown={(e) => onRowKeyDown(e, idx, fieldIndex)}
                                                    placeholder="0.00"
                                                    data-row={idx}
                                                    data-field-index={fieldIndex}
                                                />
                                            </div>
                                        ) : (
                                            <input
                                                type={column.field === 'date' ? 'date' : 'text'}
                                                className={INPUT_BASE}
                                                value={row[column.field]}
                                                onChange={(e) => updateRow(idx, column.field, e.target.value)}
                                                onKeyDown={(e) => onRowKeyDown(e, idx, fieldIndex)}
                                                placeholder={column.placeholder}
                                                data-row={idx}
                                                data-field-index={fieldIndex}
                                            />
                                        )}
                                    </div>
                                ))}
                                <div className="flex md:justify-end">
                                    {isTrailingBlank ? (
                                        <span className="hidden md:inline text-xs text-gray-400 dark:text-slate-500">Start typing to add</span>
                                    ) : (
                                        <button
                                            className={BUTTON_DANGER}
                                            onClick={() => removeRow(idx)}
                                            disabled={rows.length === 1}
                                            title="Remove this cheque"
                                        >
                                            <Icon path={ICONS.trash} className="h-4 w-4" />
                                            <span className="md:hidden">Remove</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Print Controls</h2>
                    <div className="space-y-3">
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                <Icon path={ICONS.bank} className="h-3.5 w-3.5" /> Bank preset
                            </label>
                            <select className={INPUT_BASE} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                                {!templates.length && <option value="">No bank preset yet</option>}
                                {templates.map((template) => <option key={template.id} value={template.id}>{template.bank_name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                <Icon path={ICONS.settings} className="h-3.5 w-3.5" /> Printer profile
                            </label>
                            <select className={INPUT_BASE} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                                <option value="">{printerProfiles.length ? 'None' : 'No printer profile yet'}</option>
                                {printerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name}{profile.is_default ? ' (Default)' : ''}</option>)}
                            </select>
                        </div>
                    </div>

                    {(!templates.length || !printerProfiles.length) && (
                        <div className="space-y-2">
                            {!templates.length && (
                                <div className="flex items-start gap-2 text-xs text-warning-700 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-900/40 rounded-lg p-2">
                                    <Icon path={ICONS.warning} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span>No bank preset found. Create one in Templates &amp; Settings before generating cheques.</span>
                                </div>
                            )}
                            {!printerProfiles.length && (
                                <div className="flex items-start gap-2 text-xs text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-900/40 rounded-lg p-2">
                                    <Icon path={ICONS.info} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span>No printer profile found. A PDF can still be generated, but a profile keeps alignment consistent.</span>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2 border-t border-gray-200 dark:border-slate-700 pt-3">
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input type="checkbox" className="rounded text-primary-600 focus:ring-primary-500" checked={persistRecords} onChange={(e) => setPersistRecords(e.target.checked)} />
                            Save generated cheques to history
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input type="checkbox" className="rounded text-primary-600 focus:ring-primary-500" checked={testPrintMode} onChange={(e) => setTestPrintMode(e.target.checked)} />
                            Test print mode
                        </label>
                    </div>

                    <p className="text-xs text-gray-400 dark:text-slate-500 flex items-start gap-1.5">
                        <Icon path={ICONS.info} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        Use 100% print scale for proper cheque alignment.
                    </p>
                </div>
            </div>

            <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="Cheque History" maxWidth="max-w-6xl">
                <div className="space-y-4">
                    <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">Review past cheque records and reprint as needed.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="relative">
                            <Icon path={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
                            <input
                                className={`${INPUT_BASE} pl-9`}
                                placeholder="Search payee, memo, amount or bank"
                                value={historyQuery}
                                onChange={(e) => setHistoryQuery(e.target.value)}
                            />
                        </div>
                        <select
                            className={INPUT_BASE}
                            value={historyBankFilter}
                            onChange={(e) => setHistoryBankFilter(e.target.value)}
                        >
                            <option value="all">All banks</option>
                            {historyBankOptions.map((bank) => (
                                <option key={bank} value={bank}>{bank}</option>
                            ))}
                        </select>
                        <div className="text-sm text-gray-600 dark:text-slate-400 flex items-center md:justify-end">{filteredHistory.length} of {history.length} records</div>
                    </div>

                    <div className="max-h-[55vh] overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 sticky top-0">
                                <tr className="text-gray-700 dark:text-slate-300">
                                    <th className="p-2 text-left">Created</th>
                                    <th className="p-2 text-left">Payee</th>
                                    <th className="p-2 text-left">Amount</th>
                                    <th className="p-2 text-left">Bank</th>
                                    <th className="p-2 text-left">Date Issued</th>
                                    <th className="p-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-700 dark:text-slate-300">
                                {filteredHistory.map((entry) => (
                                    <tr key={entry.id} className="border-t border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                        <td className="p-2 whitespace-nowrap">{format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm')}</td>
                                        <td className="p-2">{entry.payee}</td>
                                        <td className="p-2">{entry.amount}</td>
                                        <td className="p-2">{entry.bank_preset || '-'}</td>
                                        <td className="p-2 whitespace-nowrap">{entry.cheque_date ? format(new Date(entry.cheque_date), 'yyyy-MM-dd') : '-'}</td>
                                        <td className="p-2 text-right space-x-2 whitespace-nowrap">
                                            <button className={BUTTON_PRIMARY} onClick={() => handleEditFromHistory(entry)}><Icon path={ICONS.edit} className="h-4 w-4" />Edit</button>
                                            <button className={BUTTON_SECONDARY} onClick={() => handleReprint(entry)}><Icon path={ICONS.history} className="h-4 w-4" />Reprint</button>
                                            <button className={BUTTON_DANGER} onClick={() => handleDelete(entry.id)}><Icon path={ICONS.trash} className="h-4 w-4" />Delete</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!filteredHistory.length && (
                            <div className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">No cheque history matches the current filters.</div>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal isOpen={Boolean(pendingHistoryEntry)} onClose={() => setPendingHistoryEntry(null)} title="Load cheque from history">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400">You already have entries in the editor. Would you like to overwrite them or append this history entry?</p>
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button className={BUTTON_SECONDARY} onClick={() => setPendingHistoryEntry(null)}>Cancel</button>
                        <button className={BUTTON_SECONDARY} onClick={() => applyHistoryEntryToEditor(pendingHistoryEntry, 'append')}>Append</button>
                        <button className={BUTTON_PRIMARY} onClick={() => applyHistoryEntryToEditor(pendingHistoryEntry, 'overwrite')}>Overwrite</button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm cheque batch">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                        You are about to generate <span className="font-semibold text-gray-800 dark:text-slate-200">{queueCount} cheque{queueCount === 1 ? '' : 's'}</span> totaling{' '}
                        <span className="font-mono font-semibold text-gray-800 dark:text-slate-200">₱{queueTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>{' '}
                        using preset <span className="font-semibold text-gray-800 dark:text-slate-200">{selectedTemplate?.bank_name || '—'}</span>.
                    </p>
                    <div className="max-h-64 overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 sticky top-0">
                                <tr className="text-gray-700 dark:text-slate-300">
                                    <th className="p-2 text-left">Date</th>
                                    <th className="p-2 text-left">Payee</th>
                                    <th className="p-2 text-right">Amount</th>
                                    <th className="p-2 text-left">Memo</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-700 dark:text-slate-300">
                                {activeRows.map((row, idx) => (
                                    <tr key={idx} className="border-t border-gray-200 dark:border-slate-700">
                                        <td className="p-2 whitespace-nowrap">{row.date}</td>
                                        <td className="p-2">{row.payee}</td>
                                        <td className="p-2 text-right font-mono">₱{Number(row.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="p-2">{row.memo || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {testPrintMode && (
                        <p className="text-xs text-primary-700 dark:text-primary-400 flex items-start gap-1.5">
                            <Icon path={ICONS.info} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            Test print mode is on — cheques will be watermarked and not saved to history as final.
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button className={BUTTON_SECONDARY} onClick={() => setConfirmOpen(false)}>Cancel</button>
                        <button className={BUTTON_PRIMARY} disabled={saving} onClick={() => { setConfirmOpen(false); generatePdf(); }}>
                            <Icon path={ICONS.receipt} className="h-4 w-4" />
                            Confirm &amp; Generate
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ChequePrintingPage;
