import { useEffect, useMemo, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';

const blankRow = () => ({ date: format(new Date(), 'yyyy-MM-dd'), payee: '', amount: '', memo: '' });

const SETTINGS_TABS = ['layout', 'date', 'amount', 'currency', 'paper', 'text', 'calibration'];

const FIELD_LABELS = {
    date: 'Date',
    payee: 'Payee',
    amountNumeric: 'Amount in figures',
    amountWords: 'Amount in words',
    memo: 'Memo',
    currency: 'Currency symbol'
};

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
    const [draftProfile, setDraftProfile] = useState({ profile_name: '', offset_x: 0, offset_y: 0, is_default: false });

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
            setDraftProfile({ profile_name: '', offset_x: 0, offset_y: 0, is_default: false });
            return;
        }
        setDraftProfile({
            profile_name: selectedProfile.profile_name || '',
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

    const onRowKeyDown = (event, rowIndex, fieldIndex) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const selector = `[data-row="${rowIndex}"][data-field-index="${fieldIndex + 1}"]`;
        const next = document.querySelector(selector);
        if (next) next.focus();
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Bank Preset</span>
                    <select className="border rounded-lg px-3 py-2 text-sm" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                        {templates.map((template) => <option key={template.id} value={template.id}>{template.bank_name}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Printer Profile</span>
                    <select className="border rounded-lg px-3 py-2 text-sm" value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                        <option value="">None</option>
                        {printerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name}{profile.is_default ? ' (Default)' : ''}</option>)}
                    </select>
                </div>
                <div className="flex gap-2">
                    <button className="px-3 py-2 border rounded-lg text-sm" onClick={() => setSettingsOpen(true)}>Settings</button>
                    <button className="px-3 py-2 border rounded-lg text-sm" onClick={() => setHistoryOpen(true)}>History</button>
                    <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50" disabled={saving} onClick={() => generatePdf()}>{saving ? 'Generating…' : 'Generate PDF'}</button>
                </div>
            </div>
            <div className="bg-white border rounded-xl p-3 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={persistRecords} onChange={(e) => setPersistRecords(e.target.checked)} />
                    Save generated cheques to history
                </label>
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={testPrintMode} onChange={(e) => setTestPrintMode(e.target.checked)} />
                    Test print mode
                </label>
            </div>

            <div className="hidden md:grid grid-cols-4 gap-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <span>Due Date</span>
                <span>Payee</span>
                <span>Amount</span>
                <span>Memo (Internal only)</span>
            </div>

            {rows.map((row, idx) => (
                <div key={idx} className="bg-white border rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                    {[
                        { field: 'date', placeholder: 'Due Date' },
                        { field: 'payee', placeholder: 'Payee' },
                        { field: 'amount', placeholder: 'Amount' },
                        { field: 'memo', placeholder: 'Memo' }
                    ].map((column, fieldIndex) => (
                        <div key={column.field} className="space-y-1">
                            <label className="md:hidden text-xs font-semibold text-gray-500 uppercase tracking-wide">{column.placeholder}</label>
                            <input
                                type={column.field === 'date' ? 'date' : 'text'}
                                key={column.field}
                                className="border rounded-lg px-3 py-2 text-sm w-full"
                                value={row[column.field]}
                                onChange={(e) => updateRow(idx, column.field, e.target.value)}
                                onKeyDown={(e) => onRowKeyDown(e, idx, fieldIndex)}
                                placeholder={column.placeholder}
                                data-row={idx}
                                data-field-index={fieldIndex}
                            />
                        </div>
                    ))}
                </div>
            ))}

            {settingsOpen && selectedTemplate && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl border w-full max-w-4xl">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="font-semibold">Cheque Settings</h3>
                            <button onClick={() => setSettingsOpen(false)}>Close</button>
                        </div>
                        <div className="px-4 pt-3 flex gap-2 border-b">
                            {SETTINGS_TABS.map((tab) => (
                                <button key={tab} className={`px-3 py-2 text-sm capitalize border-b-2 ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                            ))}
                        </div>
                        <div className="p-4 max-h-[65vh] overflow-auto text-sm space-y-4">
                            {activeTab === 'layout' && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        <span>Field</span>
                                        <span>X Position</span>
                                        <span>Y Position</span>
                                        <span>Font Size</span>
                                    </div>
                                    {Object.entries(selectedTemplate.field_positions || {}).map(([field, cfg]) => (
                                        <div key={field} className="grid grid-cols-4 gap-2 items-center">
                                            <span className="font-medium">{FIELD_LABELS[field] || field}</span>
                                            <input type="number" className="border rounded px-2 py-1" aria-label={`${field} X`} value={cfg.x ?? 0} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, x: Number(e.target.value) } } })} />
                                            <input type="number" className="border rounded px-2 py-1" aria-label={`${field} Y`} value={cfg.y ?? 0} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, y: Number(e.target.value) } } })} />
                                            <input type="number" className="border rounded px-2 py-1" aria-label={`${field} Font`} value={cfg.fontSize ?? 11} onChange={(e) => updateTemplate({ field_positions: { ...selectedTemplate.field_positions, [field]: { ...cfg, fontSize: Number(e.target.value) } } })} />
                                        </div>
                                    ))}
                                </div>
                            )}
                            {activeTab === 'date' && (
                                <div className="space-y-3">
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Date output format</label>
                                    <select className="border rounded px-3 py-2" value={selectedTemplate.date_format || 'MM-dd-yyyy'} onChange={(e) => updateTemplate({ date_format: e.target.value })}>
                                        <option value="MM-dd-yyyy">MM-DD-YYYY</option>
                                        <option value="MM/dd/yyyy">MM/dd/yyyy</option>
                                        <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                                        <option value="MMM dd, yyyy">MMM dd, yyyy</option>
                                    </select>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        <select
                                            className="border rounded px-3 py-2"
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
                                        <input
                                            type="number"
                                            step="0.5"
                                            className="border rounded px-3 py-2"
                                            placeholder="Character spacing"
                                            value={selectedTemplate.field_positions?.date?.charSpacing ?? 0}
                                            onChange={(e) => updateTemplate({
                                                field_positions: {
                                                    ...selectedTemplate.field_positions,
                                                    date: { ...(selectedTemplate.field_positions?.date || {}), charSpacing: Number(e.target.value) || 0 }
                                                }
                                            })}
                                        />
                                    </div>
                                </div>
                            )}
                            {activeTab === 'amount' && (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount words casing</label>
                                        <select className="border rounded px-3 py-2" value={selectedTemplate.amount_format || 'title_case'} onChange={(e) => updateTemplate({ amount_format: e.target.value })}>
                                            <option value="title_case">Title Case</option>
                                            <option value="upper">UPPER CASE</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Amount suffix</label>
                                        <input
                                            className="border rounded px-3 py-2 w-full"
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
                                    <input className="border rounded px-3 py-2" value={selectedTemplate.currency_settings?.label || ''} onChange={(e) => updateTemplate({ currency_settings: { ...selectedTemplate.currency_settings, label: e.target.value } })} />
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
                                                className="border rounded px-3 py-2 w-full"
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
                                                className="border rounded px-3 py-2 w-full"
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
                                    <div className="border rounded-lg p-3 space-y-2">
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
                                            className="border rounded px-3 py-2 w-full"
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
                                    <div className="border rounded-lg p-3 space-y-2">
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
                                            className="border rounded px-3 py-2 w-full"
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
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <input
                                            className="border rounded px-3 py-2"
                                            placeholder="Profile name"
                                            value={draftProfile.profile_name}
                                            onChange={(e) => setDraftProfile((prev) => ({ ...prev, profile_name: e.target.value }))}
                                        />
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="border rounded px-3 py-2"
                                            placeholder="Offset X"
                                            value={draftProfile.offset_x}
                                            onChange={(e) => setDraftProfile((prev) => ({ ...prev, offset_x: Number(e.target.value) || 0 }))}
                                        />
                                        <input
                                            type="number"
                                            step="0.1"
                                            className="border rounded px-3 py-2"
                                            placeholder="Offset Y"
                                            value={draftProfile.offset_y}
                                            onChange={(e) => setDraftProfile((prev) => ({ ...prev, offset_y: Number(e.target.value) || 0 }))}
                                        />
                                    </div>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(draftProfile.is_default)}
                                            onChange={(e) => setDraftProfile((prev) => ({ ...prev, is_default: e.target.checked }))}
                                        />
                                        Set as default profile
                                    </label>
                                    <div className="flex gap-2">
                                        <button className="px-3 py-2 border rounded" onClick={() => upsertProfile(draftProfile)}>
                                            {selectedProfile ? 'Save Profile' : 'Create Profile'}
                                        </button>
                                        {!selectedProfile && (
                                            <button className="px-3 py-2 border rounded" onClick={() => setDraftProfile({ profile_name: `Profile ${printerProfiles.length + 1}`, offset_x: 0, offset_y: 0, is_default: false })}>
                                                Quick Fill
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-gray-600">Offsets are automatically applied to generated PDFs when this profile is selected.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {historyOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl border w-full max-w-5xl">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="font-semibold">Cheque History</h3>
                            <button onClick={() => setHistoryOpen(false)}>Close</button>
                        </div>
                        <div className="max-h-[70vh] overflow-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
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
                                    {history.map((entry) => (
                                        <tr key={entry.id} className="border-t">
                                            <td className="p-2">{format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm')}</td>
                                            <td className="p-2">{entry.payee}</td>
                                            <td className="p-2">{entry.amount}</td>
                                            <td className="p-2">{entry.bank_preset || '-'}</td>
                                            <td className="p-2">{entry.cheque_date ? format(new Date(entry.cheque_date), 'yyyy-MM-dd') : '-'}</td>
                                            <td className="p-2 text-right space-x-2">
                                                <button className="border rounded px-2 py-1" onClick={() => handleReprint(entry)}>Reprint</button>
                                                <button className="border rounded px-2 py-1 text-red-600" onClick={() => handleDelete(entry.id)}>Delete</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChequePrintingPage;
