import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../../api';
import Icon from '../ui/Icon';
import SegmentedTabs from '../ui/SegmentedTabs';
import { ICONS } from '../../constants';

const DEFAULT_TEMPLATE = {
    date: { x: 426, y: 178, alignment: 'left', fontSize: 11, mode: 'boxed', charSpacing: 14 },
    payee: { x: 72, y: 136, alignment: 'left', fontSize: 12, maxWidth: 380, minFontSize: 8 },
    amountNumeric: { x: 534, y: 136, alignment: 'right', fontSize: 12 },
    amountWords: { x: 72, y: 104, alignment: 'left', fontSize: 11, maxWidth: 420 },
    memo: { x: 72, y: 84, alignment: 'left', fontSize: 10, maxWidth: 220 },
    currency: { x: 474, y: 136, alignment: 'left', fontSize: 11 }
};

const SETTINGS_TABS = [
    { key: 'layout', label: 'Layout' },
    { key: 'date', label: 'Date' },
    { key: 'amount', label: 'Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'paper', label: 'Paper' },
    { key: 'text', label: 'Text' },
    { key: 'calibration', label: 'Calibration' }
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
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700`;
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-primary-600 text-white hover:bg-primary-700`;
const BUTTON_DANGER = `${BUTTON_BASE} border border-danger-200 dark:border-danger-900/50 bg-white dark:bg-slate-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20`;
const INPUT_BASE = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/30';
const LABEL_CLASS = 'block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1';

const ChequeSettingsPanel = () => {
    const [templates, setTemplates] = useState([]);
    const [printerProfiles, setPrinterProfiles] = useState([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [activeTab, setActiveTab] = useState('layout');
    const [draftProfile, setDraftProfile] = useState({ profile_name: '', feed_type: 'native', offset_x: 0, offset_y: 0, is_default: false });

    const selectedTemplate = useMemo(() => templates.find((tpl) => String(tpl.id) === String(selectedTemplateId)), [templates, selectedTemplateId]);
    const selectedProfile = useMemo(() => printerProfiles.find((profile) => String(profile.id) === String(selectedProfileId)), [printerProfiles, selectedProfileId]);

    const loadData = async () => {
        try {
            const [templatesRes, profilesRes] = await Promise.all([api.get('/cheques/templates'), api.get('/cheques/printer-profiles')]);
            const templateRows = templatesRes.data || [];
            const profileRows = profilesRes.data || [];
            setTemplates(templateRows);
            setPrinterProfiles(profileRows);
            if (!selectedTemplateId && templateRows.length) setSelectedTemplateId(String(templateRows[0].id));
            if (!selectedProfileId && profileRows.length) {
                const defaultProfile = profileRows.find((profile) => profile.is_default) || profileRows[0];
                setSelectedProfileId(String(defaultProfile.id));
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to load cheque templates & printer profiles.');
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
                bank_name: bankName.trim(),
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
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 md:p-5">
                <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-slate-100">Templates &amp; Settings</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Manage bank cheque presets and printer calibration profiles used across Print Cheques and the Treasury Desk.</p>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 md:p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={LABEL_CLASS}>Bank preset</label>
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
                        <label className={LABEL_CLASS}>Printer profile</label>
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

                <div className="border-t border-gray-200 dark:border-slate-700 pt-3 overflow-x-auto">
                    <SegmentedTabs tabs={SETTINGS_TABS} active={activeTab} onChange={setActiveTab} />
                </div>

                <div className="text-sm space-y-4">
                    {activeTab === 'layout' && selectedTemplate && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900/40 p-3">
                                <div>
                                    <p className="font-medium text-gray-900 dark:text-slate-100">Bank preset details</p>
                                    <p className="text-xs text-gray-500 dark:text-slate-400">Save and share this bank preset including cheque layout variables.</p>
                                </div>
                                <button className={BUTTON_PRIMARY} onClick={() => updateTemplate({ ...selectedTemplate })}>
                                    <Icon path={ICONS.settings} className="h-4 w-4" />
                                    Save Bank Preset
                                </button>
                            </div>
                            <div>
                                <label className={LABEL_CLASS}>Bank preset name</label>
                                <input className={INPUT_BASE} value={selectedTemplate.bank_name || ''} onChange={(e) => updateTemplate({ bank_name: e.target.value })} />
                            </div>
                            <p className="text-gray-600 dark:text-slate-400">Fine-tune field placements and sizes for this cheque template.</p>
                            <div className="grid grid-cols-4 lg:grid-cols-6 gap-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
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
                                    <div key={field} className="grid grid-cols-4 lg:grid-cols-6 gap-2 items-center border border-gray-200 dark:border-slate-700 rounded-lg p-2">
                                        <span className="font-medium truncate text-gray-800 dark:text-slate-200" title={FIELD_LABELS[field] || field}>{FIELD_LABELS[field] || field}</span>
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
                            <p className="text-gray-600 dark:text-slate-400">No bank preset exists yet. Create one or import settings to begin configuring cheque layout.</p>
                            <div className="flex gap-2">
                                <button className={BUTTON_PRIMARY} onClick={createTemplateFromCurrent}>Create Bank Preset</button>
                                <label className={`${BUTTON_SECONDARY} cursor-pointer`}>
                                    Import Presets &amp; Profiles
                                    <input type="file" accept="application/json" className="hidden" onChange={importSettingsFile} />
                                </label>
                            </div>
                        </div>
                    )}

                    {activeTab === 'date' && selectedTemplate && (
                        <div className="space-y-3">
                            <div>
                                <label className={LABEL_CLASS}>Date output format</label>
                                <select className={INPUT_BASE} value={selectedTemplate.date_format || 'MM-dd-yyyy'} onChange={(e) => updateTemplate({ date_format: e.target.value })}>
                                    <option value="MM-dd-yyyy">MM-DD-YYYY</option>
                                    <option value="MM/dd/yyyy">MM/dd/yyyy</option>
                                    <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                                    <option value="MMM dd, yyyy">MMM dd, yyyy</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                    <label className={LABEL_CLASS}>Date Mode</label>
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
                                        <label className={LABEL_CLASS}>Char Spacing</label>
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
                                            <label className={LABEL_CLASS}>Block Spacing</label>
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

                    {activeTab === 'amount' && selectedTemplate && (
                        <div className="space-y-3">
                            <div>
                                <label className={LABEL_CLASS}>Amount words casing</label>
                                <select className={INPUT_BASE} value={selectedTemplate.amount_format || 'title_case'} onChange={(e) => updateTemplate({ amount_format: e.target.value })}>
                                    <option value="title_case">Title Case</option>
                                    <option value="upper">UPPER CASE</option>
                                </select>
                            </div>
                            <div>
                                <label className={LABEL_CLASS}>Amount suffix</label>
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
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Whole numbers render as “&lt;amount&gt; suffix only”. Decimal amounts render as “&lt;amount&gt; suffix and xx/100”.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'currency' && selectedTemplate && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-gray-700 dark:text-slate-300"><input type="checkbox" checked={selectedTemplate.currency_settings?.enabled !== false} onChange={(e) => updateTemplate({ currency_settings: { ...selectedTemplate.currency_settings, enabled: e.target.checked } })} /> Show currency label</label>
                            <label className={LABEL_CLASS}>Symbol outside amount box</label>
                            <input className={INPUT_BASE} value={selectedTemplate.currency_settings?.label || ''} onChange={(e) => updateTemplate({ currency_settings: { ...selectedTemplate.currency_settings, label: e.target.value } })} />
                        </div>
                    )}

                    {activeTab === 'paper' && selectedTemplate && (
                        <div className="space-y-3">
                            <p className="text-gray-600 dark:text-slate-400">Paper size is stored in the selected bank preset.</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                    <label className={LABEL_CLASS}>Width (inches)</label>
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
                                    <label className={LABEL_CLASS}>Height (inches)</label>
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
                            <p className="text-xs text-gray-500 dark:text-slate-400">Recommended standardized size: 8" x 3".</p>
                        </div>
                    )}

                    {activeTab === 'text' && selectedTemplate && (
                        <div className="space-y-3">
                            <p className="text-gray-600 dark:text-slate-400">Payee overflow mitigation uses template font size and width values; no line wrapping is applied.</p>
                            <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-slate-900/40">
                                <label className="flex items-center gap-2 text-gray-700 dark:text-slate-300">
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
                            <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-2 bg-gray-50 dark:bg-slate-900/40">
                                <label className="flex items-center gap-2 text-gray-700 dark:text-slate-300">
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
                            <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 bg-gray-50 dark:bg-slate-900/40 space-y-2">
                                <p className="font-medium text-gray-900 dark:text-slate-100">Import / Export Configuration</p>
                                <p className="text-xs text-gray-600 dark:text-slate-400">Export all bank presets and printer profiles to a JSON file for sharing or backup.</p>
                                <div className="flex flex-wrap gap-2">
                                    <button className={BUTTON_SECONDARY} onClick={downloadSettingsExport}>Export Presets &amp; Profiles</button>
                                    <label className={`${BUTTON_SECONDARY} cursor-pointer`}>
                                        Import Presets &amp; Profiles
                                        <input type="file" accept="application/json" className="hidden" onChange={importSettingsFile} />
                                    </label>
                                </div>
                            </div>
                            <p className="text-gray-600 dark:text-slate-400">Save profile offsets to match your printer's physical output alignment.</p>
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
                            <p className="text-xs text-gray-500 dark:text-slate-400">If your printer rejects custom 8x3 paper sizes, select your manual tray&apos;s feed alignment. The system will print on a Letter canvas to bypass the error.</p>
                            <label className="flex items-center gap-2 text-gray-700 dark:text-slate-300">
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
    );
};

export default ChequeSettingsPanel;
