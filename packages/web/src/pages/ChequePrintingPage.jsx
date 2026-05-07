import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';
// eslint-disable-next-line no-unused-vars
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const blankRow = () => ({ date: format(new Date(), 'yyyy-MM-dd'), payee: '', amount: '', memo: '' });
const DEFAULT_TEMPLATE = {
    date: { x: 426, y: 178, alignment: 'left', fontSize: 11, mode: 'boxed', charSpacing: 14 },
    payee: { x: 72, y: 136, alignment: 'left', fontSize: 12, maxWidth: 380, minFontSize: 8 },
    amountNumeric: { x: 534, y: 136, alignment: 'right', fontSize: 12 },
    amountWords: { x: 72, y: 104, alignment: 'left', fontSize: 11, maxWidth: 420 },
    memo: { x: 72, y: 84, alignment: 'left', fontSize: 10, maxWidth: 220 },
    currency: { x: 474, y: 136, alignment: 'left', fontSize: 11 }
};

const SETTINGS_TABS = [
    { id: 'layout', label: 'Layout' },
    { id: 'date', label: 'Date' },
    { id: 'amount', label: 'Amount' },
    { id: 'currency', label: 'Currency' },
    { id: 'paper', label: 'Paper' },
    { id: 'text', label: 'Text' },
    { id: 'calibration', label: 'Calibration' }
];

const FIELD_LABELS = {
    date: 'Date',
    payee: 'Payee',
    amountNumeric: 'Amount in figures',
    amountWords: 'Amount in words',
    memo: 'Memo',
    currency: 'Currency symbol'
};

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-blue-600 text-white hover:bg-blue-700`;
const BUTTON_DANGER = `${BUTTON_BASE} border border-red-200 bg-white text-red-600 hover:bg-red-50`;
const INPUT_BASE = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

const ChequePrintingPage = () => {
    const [templates, setTemplates] = useState([]);
    const [printerProfiles, setPrinterProfiles] = useState([]);
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [rows, setRows] = useState([blankRow()]);
    const [history, setHistory] = useState([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('layout');
    const [saving, setSaving] = useState(false);
    const [persistRecords, setPersistRecords] = useState(true);
    const [testPrintMode, setTestPrintMode] = useState(false);
    const [historyQuery, setHistoryQuery] = useState('');
    const [historyBankFilter, setHistoryBankFilter] = useState('all');
    const [pendingHistoryEntry, setPendingHistoryEntry] = useState(null);
    const [draftProfile, setDraftProfile] = useState({ profile_name: '', feed_type: 'native', offset_x: 0, offset_y: 0, is_default: false });

    const selectedTemplate = useMemo(() => templates.find((tpl) => String(tpl.id) === String(selectedTemplateId)), [templates, selectedTemplateId]);
    const selectedProfile = useMemo(() => printerProfiles.find((profile) => String(profile.id) === String(selectedProfileId)), [printerProfiles, selectedProfileId]);

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
    useEffect(() => {
        if (!selectedProfile) {
            setDraftProfile({ profile_name: '', feed_type: 'native', offset_x: 0, offset_y: 0, is_default: false });
            return;
        }
        setDraftProfile({
            profile_name: selectedProfile.profile_name || '',
            feed_type: selectedProfile.feed_type || 'native',
            offset_x: Number(selectedProfile.offset_x || 0),
            offset_y: Number(selectedProfile.offset_y || 0),
            is_default: Boolean(selectedProfile.is_default)
        });
    }, [selectedProfileId]);

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
            if (renderer === 'fallback') {
                toast((rendererWarning || 'Fallback PDF renderer was used because pdf-lib is unavailable.'), { icon: '⚠️' });
            }

            const pdfBlob = new Blob([pdfResponse.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(pdfBlob);
            window.open(url, '_blank', 'noopener,noreferrer');
            const printOk = window.confirm('PDF opened. Print using 100% scale.\nDid the print preview open correctly?');
            if (!printOk) {
                toast.error('Print confirmation failed. Please check popup permissions or browser print settings.');
                return;
            }

            if (persist) {
                await api.post('/cheques/records', {
                    template_id: Number(selectedTemplateId),
                    records: payloadRows
                });
                toast.success('Cheque PDF generated. Print using 100% scale.');
                setRows([blankRow()]);
                await loadData();
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

    const updateTemplate = async (patch) => {
        if (!selectedTemplate) return;
        try {
            const response = await api.put(`/cheques/templates/${selectedTemplate.id}`, {
                ...selectedTemplate,
                ...patch
            });
            setTemplates((prev) => prev.map((template) => (template.id === response.data.id ? response.data : template)));
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Template update failed.');
        }
    };

    const upsertProfile = async (patch) => {
        try {
            if (!selectedProfile) {
                const created = await api.post('/cheques/printer-profiles', {
                    profile_name: patch.profile_name || `Profile ${printerProfiles.length + 1}`,
                    feed_type: patch.feed_type || 'native',
                    offset_x: patch.offset_x || 0,
                    offset_y: patch.offset_y || 0,
                    is_default: patch.is_default || false
                });
                setPrinterProfiles((prev) => [...prev, created.data]);
                setSelectedProfileId(String(created.data.id));
                return;
            }

            const response = await api.put(`/cheques/printer-profiles/${selectedProfile.id}`, {
                ...selectedProfile,
                ...patch
            });

            setPrinterProfiles((prev) => prev.map((profile) => (profile.id === response.data.id ? response.data : profile)));
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Printer profile update failed.');
        }
    };

    const createTemplateFromCurrent = async () => {
        const baseName = selectedTemplate?.bank_name || 'New Bank Preset';
        const bankName = window.prompt('Enter name for bank preset:', selectedTemplate ? `${baseName} Copy` : baseName);
        if (!bankName?.trim()) return;
        try {
            const res = await api.post('/cheques/templates', {
                ...(selectedTemplate || {}),
                bank_name: bankName.trim()
                ,
                field_positions: selectedTemplate?.field_positions || DEFAULT_TEMPLATE
            });
            setTemplates((prev) => [...prev, res.data].sort((a, b) => a.bank_name.localeCompare(b.bank_name)));
            setSelectedTemplateId(String(res.data.id));
            toast.success(selectedTemplate ? 'Bank preset duplicated.' : 'Bank preset created.');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to save bank preset.');
        }
    };

    const deleteCurrentTemplate = async () => {
        if (!selectedTemplate) return;
        if (!window.confirm(`Delete bank preset "${selectedTemplate.bank_name}"?`)) return;
        try {
            await api.delete(`/cheques/templates/${selectedTemplate.id}`);
            toast.success('Bank preset deleted.');
            await loadData();
            setSelectedTemplateId('');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to delete bank preset.');
        }
    };

    const duplicateCurrentProfile = async () => {
        if (!selectedProfile) return;
        const profileName = window.prompt('Enter name for duplicated printer profile:', `${selectedProfile.profile_name} Copy`);
        if (!profileName?.trim()) return;
        try {
            const created = await api.post('/cheques/printer-profiles', {
                profile_name: profileName.trim(),
                feed_type: selectedProfile.feed_type || 'native',
                offset_x: Number(selectedProfile.offset_x || 0),
                offset_y: Number(selectedProfile.offset_y || 0),
                is_default: false
            });
            setPrinterProfiles((prev) => [...prev, created.data]);
            setSelectedProfileId(String(created.data.id));
            toast.success('Printer profile duplicated.');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to duplicate printer profile.');
        }
    };

    const deleteCurrentProfile = async () => {
        if (!selectedProfile) return;
        if (!window.confirm(`Delete printer profile "${selectedProfile.profile_name}"?`)) return;
        try {
            await api.delete(`/cheques/printer-profiles/${selectedProfile.id}`);
            toast.success('Printer profile deleted.');
            await loadData();
            setSelectedProfileId('');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to delete printer profile.');
        }
    };

    const onRowKeyDown = (event, rowIndex, fieldIndex) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const selector = `[data-row="${rowIndex}"][data-field-index="${fieldIndex + 1}"]`;
        const next = document.querySelector(selector);
        if (next) next.focus();
    };

    const downloadSettingsExport = async () => {
        try {
            const response = await api.get('/cheques/settings-export', { responseType: 'blob' });
            const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = blobUrl;
            link.setAttribute('download', `cheque-settings-${format(new Date(), 'yyyy-MM-dd')}.json`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(blobUrl);
            toast.success('Cheque settings exported.');
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to export cheque settings.');
        }
    };

    const importSettingsFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const payload = JSON.parse(await file.text());
            const overwrite = window.confirm('Overwrite existing presets/profiles with matching names? Click Cancel to append only.');
            await api.post('/cheques/settings-import', { ...payload, overwrite });
            toast.success('Cheque settings imported.');
            await loadData();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to import cheque settings file.');
        } finally {
            event.target.value = '';
        }
    };

    return (
        <div className="space-y-4 pb-4">
            <div className="bg-white border rounded-xl p-4 md:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <h1 className="text-lg md:text-xl font-semibold text-gray-900">Cheque Printing</h1>
                        <p className="text-sm text-gray-500 mt-1">Prepare cheques, manage print calibration, and review printed cheque history in one place.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className={BUTTON_SECONDARY} onClick={() => setSettingsOpen(true)}>
                            <Icon path={ICONS.settings} className="h-4 w-4" />
                            Open Settings
                        </button>
                        <button className={BUTTON_SECONDARY} onClick={() => setHistoryOpen(true)}>
                            <Icon path={ICONS.history} className="h-4 w-4" />
                            View History
                        </button>
                        <button className={BUTTON_PRIMARY} disabled={saving} onClick={() => generatePdf()}>
                            <Icon path={ICONS.receipt} className="h-4 w-4" />
                            {saving ? 'Generating…' : 'Generate PDF'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 bg-white border rounded-xl p-4 space-y-4">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Print Queue</h2>
                    <div className="hidden md:grid grid-cols-[120px_1fr_160px_1fr_80px] gap-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        <span>Date</span>
                        <span>Payee</span>
                        <span>Amount</span>
                        <span>Memo</span>
                        <span className="text-right">Actions</span>
                    </div>

                    {rows.map((row, idx) => {
                        const isTrailingBlank = idx === rows.length - 1 && !row.payee && !row.amount && !row.memo;
                        return (
                            <div key={idx} className="bg-gray-50/70 border rounded-xl p-3 grid grid-cols-1 md:grid-cols-[120px_1fr_160px_1fr_80px] gap-3 items-start">
                                {[
                                    { field: 'date', placeholder: 'Date' },
                                    { field: 'payee', placeholder: 'Payee' },
                                    { field: 'amount', placeholder: 'Amount' },
                                    { field: 'memo', placeholder: 'Memo' }
                                ].map((column, fieldIndex) => (
                                    <div key={column.field} className="space-y-1">
                                        <label className="md:hidden text-xs font-semibold text-gray-500 uppercase tracking-wide">{column.placeholder}</label>
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
                                    </div>
                                ))}
                                <div className="flex md:justify-end">
                                    <button
                                        className={BUTTON_DANGER}
                                        onClick={() => removeRow(idx)}
                                        disabled={rows.length === 1 || isTrailingBlank}
                                    >
                                        <Icon path={ICONS.trash} className="h-4 w-4" />
                                        Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="bg-white border rounded-xl p-4 space-y-4">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Print Controls</h2>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Bank preset</label>
                            <select className={INPUT_BASE} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                                {!templates.length && <option value="">No bank preset yet</option>}
                                {templates.map((template) => <option key={template.id} value={template.id}>{template.bank_name}</option>)}
                            </select>
                            <div className="flex gap-2 mt-2">
                                <button className={BUTTON_SECONDARY} onClick={createTemplateFromCurrent}>{selectedTemplate ? 'Duplicate Preset' : 'Create Preset'}</button>
                                <button className={BUTTON_DANGER} onClick={deleteCurrentTemplate} disabled={!selectedTemplate || templates.length <= 1}>Delete Preset</button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Printer profile</label>
                            <select className={INPUT_BASE} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                                <option value="">{printerProfiles.length ? 'None' : 'No printer profile yet'}</option>
                                {printerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name}{profile.is_default ? ' (Default)' : ''}</option>)}
                            </select>
                            <div className="flex gap-2 mt-2">
                                <button className={BUTTON_SECONDARY} onClick={duplicateCurrentProfile} disabled={!selectedProfile}>Duplicate Profile</button>
                                <button className={BUTTON_DANGER} onClick={deleteCurrentProfile} disabled={!selectedProfile}>Delete Profile</button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2 border-t pt-3">
                        {!templates.length && (
                            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                                No bank preset found. Create one in Settings or import presets before generating cheques.
                            </div>
                        )}
                        {!printerProfiles.length && (
                            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2">
                                No printer profile found. You can still generate a PDF, but creating a profile is recommended for proper alignment.
                            </div>
                        )}
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={persistRecords} onChange={(e) => setPersistRecords(e.target.checked)} />
                            Save generated cheques to history
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={testPrintMode} onChange={(e) => setTestPrintMode(e.target.checked)} />
                            Test print mode
                        </label>
                    </div>

                    <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                        Tip: Use <span className="font-semibold">100% print scale</span> for proper cheque alignment.
                    </div>
                </div>
            </div>

            {settingsOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl border w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-gray-900">Cheque Settings</h3>
                                <p className="text-xs text-gray-500 mt-0.5">Preset: {selectedTemplate?.bank_name || 'None selected'}</p>
                            </div>
                            <button className={BUTTON_SECONDARY} onClick={() => setSettingsOpen(false)}><Icon path={ICONS.close} className="h-4 w-4" />Close</button>
                        </div>

                        <div className="min-h-0 flex-1 flex flex-col">
                            <div className="border-b px-4 md:px-5 overflow-x-auto">
                                <div className="flex items-center gap-5 min-w-max">
                                    {SETTINGS_TABS.map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}
                                            onClick={() => setActiveTab(tab.id)}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="p-4 md:p-5 overflow-auto text-sm space-y-4">
                                {activeTab === 'layout' && selectedTemplate && (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2 border rounded-lg bg-gray-50 p-3">
                                            <div>
                                                <p className="font-medium text-gray-900">Bank preset details</p>
                                                <p className="text-xs text-gray-500">Save and share this bank preset including cheque layout variables.</p>
                                            </div>
                                            <button className={BUTTON_PRIMARY} onClick={() => updateTemplate({ ...selectedTemplate })}>
                                                <Icon path={ICONS.settings} className="h-4 w-4" />
                                                Save Bank Preset
                                            </button>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Bank preset name</label>
                                            <input className={INPUT_BASE} value={selectedTemplate.bank_name || ''} onChange={(e) => updateTemplate({ bank_name: e.target.value })} />
                                        </div>
                                        <p className="text-gray-600">Fine-tune field placements and sizes for this cheque template.</p>
                                        <div className="grid grid-cols-4 lg:grid-cols-6 gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                            <span>Field</span>
                                            <span>X Position</span>
                                            <span>Y Position</span>
                                            <span>Font Size</span>
                                            <span className="hidden lg:block">Max Width</span>
                                            <span className="hidden lg:block">Min Font</span>
                                        </div>
                                        {Object.entries(selectedTemplate.field_positions || {}).map(([field, cfg]) => {
                                            const showExtras = ['payee', 'amountWords', 'memo'].includes(field);
                                            return (
                                                <div key={field} className="grid grid-cols-4 lg:grid-cols-6 gap-2 items-center border rounded-lg p-2">
                                                    <span className="font-medium truncate" title={FIELD_LABELS[field] || field}>{FIELD_LABELS[field] || field}</span>
                                                    <input type="number" className={INPUT_BASE} aria-label={`${field} X`} value={cfg.x ?? 0} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, x: Number(e.target.value) } } })} />
                                                    <input type="number" className={INPUT_BASE} aria-label={`${field} Y`} value={cfg.y ?? 0} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, y: Number(e.target.value) } } })} />
                                                    <input type="number" className={INPUT_BASE} aria-label={`${field} Font`} value={cfg.fontSize ?? 11} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, fontSize: Number(e.target.value) } } })} />
                                                    {showExtras ? (
                                                        <>
                                                            <input type="number" className={`${INPUT_BASE} col-span-2 lg:col-span-1`} aria-label={`${field} Max Width`} placeholder="Max Width" value={cfg.maxWidth ?? ''} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, maxWidth: e.target.value ? Number(e.target.value) : null } } })} />
                                                            <input type="number" className={`${INPUT_BASE} col-span-2 lg:col-span-1`} aria-label={`${field} Min Font`} placeholder="Min Font" value={cfg.minFontSize ?? ''} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, minFontSize: e.target.value ? Number(e.target.value) : null } } })} />
                                                        </>
                                                    ) : (
                                                        <div className="hidden lg:block lg:col-span-2"></div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {activeTab === 'layout' && !selectedTemplate && (
                                    <div className="space-y-3">
                                        <p className="text-gray-600">No bank preset exists yet. Create one or import settings to begin configuring cheque layout.</p>
                                        <div className="flex gap-2">
                                            <button className={BUTTON_PRIMARY} onClick={createTemplateFromCurrent}>Create Bank Preset</button>
                                            <label className={`${BUTTON_SECONDARY} cursor-pointer`}>
                                                Import Presets & Profiles
                                                <input type="file" accept="application/json" className="hidden" onChange={importSettingsFile} />
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'date' && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date output format</label>
                                            <select className={INPUT_BASE} value={selectedTemplate.date_format || 'MM-dd-yyyy'} onChange={(e) => updateTemplate({ date_format: e.target.value })}>
                                                <option value="MM-dd-yyyy">MM-DD-YYYY</option>
                                                <option value="MM/dd/yyyy">MM/dd/yyyy</option>
                                                <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                                                <option value="MMM dd, yyyy">MMM dd, yyyy</option>
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Date Mode</label>
                                                <select
                                                    className={INPUT_BASE}
                                                    value={selectedTemplate.field_positions?.date?.mode || 'single'}
                                                    onChange={(e) => updateTemplate({
                                                        field_positions: {
                                                            ...selectedTemplate.field_positions,
                                                            date: { ...(selectedTemplate.field_positions?.date || {}), mode: e.target.value }
                                                        }
                                                    })}
                                                >
                                                    <option value="single">Single-line date mode</option>
                                                    <option value="boxed">Boxed date mode (MMDDYYYY without separators)</option>
                                                </select>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Char Spacing</label>
                                                    <input
                                                        type="number"
                                                        step="0.5"
                                                        className={INPUT_BASE}
                                                        placeholder="Character spacing"
                                                        title="Character spacing"
                                                        value={selectedTemplate.field_positions?.date?.charSpacing ?? 0}
                                                        onChange={(e) => updateTemplate({
                                                            field_positions: {
                                                                ...selectedTemplate.field_positions,
                                                                date: { ...(selectedTemplate.field_positions?.date || {}), charSpacing: Number(e.target.value) || 0 }
                                                            }
                                                        })}
                                                    />
                                                </div>
                                                {selectedTemplate.field_positions?.date?.mode === 'boxed' && (
                                                    <div className="flex-1">
                                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Block Spacing</label>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            className={INPUT_BASE}
                                                            placeholder="Block Spacing (pt)"
                                                            title="Block Spacing (pt)"
                                                            value={selectedTemplate.field_positions?.date?.blockSpacing ?? selectedTemplate.field_positions?.date?.charSpacing ?? 0}
                                                            onChange={(e) => updateTemplate({
                                                                field_positions: {
                                                                    ...selectedTemplate.field_positions,
                                                                    date: { ...(selectedTemplate.field_positions?.date || {}), blockSpacing: Number(e.target.value) || 0 }
                                                                }
                                                            })}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'amount' && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount words casing</label>
                                            <select className={INPUT_BASE} value={selectedTemplate.amount_format || 'title_case'} onChange={(e) => updateTemplate({ amount_format: e.target.value })}>
                                                <option value="title_case">Title Case</option>
                                                <option value="upper">UPPER CASE</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount suffix</label>
                                            <input
                                                className={INPUT_BASE}
                                                placeholder="pesos"
                                                value={selectedTemplate.amount_words_settings?.suffix || 'pesos'}
                                                onChange={(e) => updateTemplate({
                                                    amount_words_settings: {
                                                        ...(selectedTemplate.amount_words_settings || {}),
                                                        suffix: e.target.value
                                                    }
                                                })}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">Whole numbers render as “&lt;amount&gt; suffix only”. Decimal amounts render as “&lt;amount&gt; suffix and xx/100”.</p>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'currency' && (
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2"><input type="checkbox" checked={selectedTemplate.currency_settings?.enabled !== false} onChange={(e) => updateTemplate({ currency_settings: { ...selectedTemplate.currency_settings, enabled: e.target.checked } })} /> Show currency label</label>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Symbol outside amount box</label>
                                        <input className={INPUT_BASE} value={selectedTemplate.currency_settings?.label || ''} onChange={(e) => updateTemplate({ currency_settings: { ...selectedTemplate.currency_settings, label: e.target.value } })} />
                                    </div>
                                )}

                                {activeTab === 'paper' && (
                                    <div className="space-y-3">
                                        <p className="text-gray-600">Paper size is stored in the selected bank preset.</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Width (inches)</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="0.1"
                                                    className={INPUT_BASE}
                                                    value={selectedTemplate.paper_settings?.widthIn ?? 8}
                                                    onChange={(e) => updateTemplate({ paper_settings: { ...(selectedTemplate.paper_settings || {}), widthIn: Number(e.target.value) || 8, unit: 'in' } })}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Height (inches)</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="0.1"
                                                    className={INPUT_BASE}
                                                    value={selectedTemplate.paper_settings?.heightIn ?? 3}
                                                    onChange={(e) => updateTemplate({ paper_settings: { ...(selectedTemplate.paper_settings || {}), heightIn: Number(e.target.value) || 3, unit: 'in' } })}
                                                />
                                            </div>
                                        </div>
                                        <p className="text-xs text-gray-500">Recommended standardized size: 8" x 3".</p>
                                    </div>
                                )}

                                {activeTab === 'text' && (
                                    <div className="space-y-3">
                                        <p className="text-gray-600">Payee overflow mitigation uses template font size and width values; no line wrapping is applied.</p>
                                        <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(selectedTemplate.text_settings?.payeeFillerEnabled)}
                                                    onChange={(e) => updateTemplate({
                                                        text_settings: {
                                                            ...(selectedTemplate.text_settings || {}),
                                                            payeeFillerEnabled: e.target.checked
                                                        }
                                                    })}
                                                />
                                                Add filler at both ends of payee text
                                            </label>
                                            <input
                                                className={INPUT_BASE}
                                                placeholder="***"
                                                value={selectedTemplate.text_settings?.payeeFiller || '***'}
                                                onChange={(e) => updateTemplate({
                                                    text_settings: {
                                                        ...(selectedTemplate.text_settings || {}),
                                                        payeeFiller: e.target.value
                                                    }
                                                })}
                                            />
                                        </div>
                                        <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
                                            <label className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={Boolean(selectedTemplate.text_settings?.amountWordsFillerEnabled)}
                                                    onChange={(e) => updateTemplate({
                                                        text_settings: {
                                                            ...(selectedTemplate.text_settings || {}),
                                                            amountWordsFillerEnabled: e.target.checked
                                                        }
                                                    })}
                                                />
                                                Add filler at both ends of amount-in-words
                                            </label>
                                            <input
                                                className={INPUT_BASE}
                                                placeholder="***"
                                                value={selectedTemplate.text_settings?.amountWordsFiller || '***'}
                                                onChange={(e) => updateTemplate({
                                                    text_settings: {
                                                        ...(selectedTemplate.text_settings || {}),
                                                        amountWordsFiller: e.target.value
                                                    }
                                                })}
                                            />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'calibration' && (
                                    <div className="space-y-3">
                                        <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                                            <p className="font-medium text-gray-900">Import / Export Configuration</p>
                                            <p className="text-xs text-gray-600">Export all bank presets and printer profiles to a JSON file for sharing or backup.</p>
                                            <div className="flex flex-wrap gap-2">
                                                <button className={BUTTON_SECONDARY} onClick={downloadSettingsExport}>Export Presets & Profiles</button>
                                                <label className={`${BUTTON_SECONDARY} cursor-pointer`}>
                                                    Import Presets & Profiles
                                                    <input type="file" accept="application/json" className="hidden" onChange={importSettingsFile} />
                                                </label>
                                            </div>
                                        </div>
                                        <p className="text-gray-600">Save profile offsets to match your printer's physical output alignment.</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <input
                                                className={INPUT_BASE}
                                                placeholder="Profile name"
                                                value={draftProfile.profile_name}
                                                onChange={(e) => setDraftProfile((prev) => ({ ...prev, profile_name: e.target.value }))}
                                            />
                                            <select
                                                className={INPUT_BASE}
                                                value={draftProfile.feed_type || 'native'}
                                                onChange={(e) => setDraftProfile((prev) => ({ ...prev, feed_type: e.target.value }))}
                                            >
                                                <option value="native">Native (Custom Paper Size)</option>
                                                <option value="letter_center">Letter Size (Center Feed)</option>
                                                <option value="letter_left">Letter Size (Left Feed)</option>
                                                <option value="letter_right">Letter Size (Right Feed)</option>
                                            </select>
                                            <input
                                                type="number"
                                                step="0.1"
                                                className={INPUT_BASE}
                                                placeholder="Offset X"
                                                value={draftProfile.offset_x}
                                                onChange={(e) => setDraftProfile((prev) => ({ ...prev, offset_x: Number(e.target.value) || 0 }))}
                                            />
                                            <input
                                                type="number"
                                                step="0.1"
                                                className={INPUT_BASE}
                                                placeholder="Offset Y"
                                                value={draftProfile.offset_y}
                                                onChange={(e) => setDraftProfile((prev) => ({ ...prev, offset_y: Number(e.target.value) || 0 }))}
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500">If your printer rejects custom 8x3 paper sizes, select your manual tray&apos;s feed alignment. The system will print on a Letter canvas to bypass the error.</p>
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(draftProfile.is_default)}
                                                onChange={(e) => setDraftProfile((prev) => ({ ...prev, is_default: e.target.checked }))}
                                            />
                                            Set as default profile
                                        </label>
                                        <div className="flex gap-2">
                                            <button className={BUTTON_PRIMARY} onClick={() => upsertProfile(draftProfile)}><Icon path={ICONS.settings} className="h-4 w-4" />{selectedProfile ? 'Save Profile' : 'Create Profile'}</button>
                                            {!selectedProfile && (
                                                <button className={BUTTON_SECONDARY} onClick={() => setDraftProfile({ profile_name: `Profile ${printerProfiles.length + 1}`, feed_type: 'native', offset_x: 0, offset_y: 0, is_default: false })}><Icon path={ICONS.edit} className="h-4 w-4" />Quick Fill</button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {historyOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl border w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h3 className="font-semibold text-gray-900">Cheque History</h3>
                                <p className="text-xs text-gray-500">Review past cheque records and reprint as needed.</p>
                            </div>
                            <button className={BUTTON_SECONDARY} onClick={() => setHistoryOpen(false)}><Icon path={ICONS.close} className="h-4 w-4" />Close</button>
                        </div>

                        <div className="p-4 border-b bg-gray-50/60 grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                                className={INPUT_BASE}
                                placeholder="Search payee, memo, amount or bank"
                                value={historyQuery}
                                onChange={(e) => setHistoryQuery(e.target.value)}
                            />
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
                            <div className="text-sm text-gray-600 flex items-center md:justify-end">{filteredHistory.length} of {history.length} records</div>
                        </div>

                        <div className="max-h-[65vh] overflow-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="p-2 text-left">Created</th>
                                        <th className="p-2 text-left">Payee</th>
                                        <th className="p-2 text-left">Amount</th>
                                        <th className="p-2 text-left">Bank</th>
                                        <th className="p-2 text-left">Date Issued</th>
                                        <th className="p-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredHistory.map((entry) => (
                                        <tr key={entry.id} className="border-t hover:bg-gray-50/70">
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
                                <div className="py-10 text-center text-sm text-gray-500">No cheque history matches the current filters.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {pendingHistoryEntry && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl border w-full max-w-lg overflow-hidden">
                        <div className="p-4 border-b">
                            <h3 className="font-semibold text-gray-900">Load cheque from history</h3>
                            <p className="text-sm text-gray-600 mt-1">You already have entries in the editor. Would you like to overwrite them or append this history entry?</p>
                        </div>
                        <div className="p-4 flex flex-wrap gap-2 justify-end">
                            <button className={BUTTON_SECONDARY} onClick={() => setPendingHistoryEntry(null)}>Cancel</button>
                            <button className={BUTTON_SECONDARY} onClick={() => applyHistoryEntryToEditor(pendingHistoryEntry, 'append')}>Append</button>
                            <button className={BUTTON_PRIMARY} onClick={() => applyHistoryEntryToEditor(pendingHistoryEntry, 'overwrite')}>Overwrite</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChequePrintingPage;
