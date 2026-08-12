import React, { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../contexts/SettingsContext';
import ColorSwatchPicker from './ColorSwatchPicker';

// Curated presets, pre-vetted for good contrast, so an admin who just wants
// "something that looks good" doesn't have to think about color theory.
const PRESETS = [
    { name: 'Forson Slate (default)', primary: '#2563eb', accent: '#7c3aed' },
    { name: 'Emerald', primary: '#059669', accent: '#0d9488' },
    { name: 'Crimson', primary: '#dc2626', accent: '#ea580c' },
    { name: 'Indigo', primary: '#4f46e5', accent: '#db2777' },
    { name: 'Slate & Amber', primary: '#334155', accent: '#d97706' },
    { name: 'Teal', primary: '#0891b2', accent: '#65a30d' },
    { name: 'Plum', primary: '#7e22ce', accent: '#c026d3' },
    { name: 'Navy', primary: '#1e3a8a', accent: '#0369a1' },
];

const DEFAULTS = {
    BRAND_PRIMARY_COLOR: '#2563eb',
    BRAND_ACCENT_COLOR: '',
    BRAND_PRIMARY_COLOR_DARK: '#3b82f6',
    BRAND_ACCENT_COLOR_DARK: '',
    BRAND_THEME_NAME: 'Forson Slate',
};

const LogoUploadWidget = ({ variant, label, hint, refreshKey, onUploaded }) => {
    const [uploading, setUploading] = useState(false);
    const [imgError, setImgError] = useState(false);

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!['image/png', 'image/svg+xml', 'image/webp'].includes(file.type)) {
            toast.error('Please upload a PNG, SVG, or WebP image.');
            e.target.value = '';
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Image is too large. Maximum size is 2MB.');
            e.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('logo', file);
        setUploading(true);
        try {
            await api.post(`/branding/logo/${variant}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            toast.success(`${label} updated.`);
            setImgError(false);
            onUploaded();
        } catch (err) {
            toast.error(err.response?.data?.message || `Failed to upload ${label.toLowerCase()}.`);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleRemove = async () => {
        try {
            await api.delete(`/branding/logo/${variant}`);
            toast.success(`${label} removed.`);
            setImgError(true);
            onUploaded();
        } catch {
            toast.error(`Failed to remove ${label.toLowerCase()}.`);
        }
    };

    return (
        <div className="flex items-center gap-4 p-4 border border-gray-200 dark:border-slate-700 rounded-lg">
            <div className="h-16 w-16 flex items-center justify-center bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden shrink-0">
                {!imgError ? (
                    <img
                        src={`/api/branding/logo/${variant}?v=${refreshKey}`}
                        alt={label}
                        className="max-h-full max-w-full object-contain"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <span className="text-xs text-gray-400 dark:text-slate-500">No logo</span>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{label}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{hint}</p>
                <div className="mt-2 flex items-center gap-3">
                    <label className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-slate-600 shadow-sm text-xs font-medium rounded-md text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer">
                        {uploading ? 'Uploading…' : 'Upload'}
                        <input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={handleFileChange} disabled={uploading} />
                    </label>
                    {!imgError && (
                        <button type="button" onClick={handleRemove} className="text-xs font-medium text-danger-600 hover:text-danger-700">
                            Remove
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const PreviewPanel = ({ label, primary, accent, dark }) => (
    <div className={dark ? 'dark' : ''}>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-3">{label}</p>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" style={{ backgroundColor: primary }} className="px-3 py-1.5 rounded-md text-white text-xs font-semibold">
                    Primary button
                </button>
                <button type="button" style={{ borderColor: primary, color: primary }} className="px-3 py-1.5 rounded-md border bg-transparent text-xs font-semibold">
                    Outline
                </button>
                {accent && (
                    <span style={{ backgroundColor: accent }} className="px-2 py-1 rounded-full text-white text-xs font-semibold">
                        Accent badge
                    </span>
                )}
                <span style={{ borderColor: primary, color: primary }} className="px-2 py-1 rounded-md border bg-transparent text-xs font-medium">
                    Selected nav
                </span>
                <span className="px-2 py-1 rounded-full bg-success-100 text-success-700 text-xs font-medium">Success</span>
                <span className="px-2 py-1 rounded-full bg-danger-100 text-danger-700 text-xs font-medium">Danger</span>
            </div>
        </div>
    </div>
);

const BrandIdentitySettings = ({ settings, handleChange, handleSave }) => {
    const { refetchTheme } = useTheme() || {};
    const { refetchSettings } = useSettings() || {};
    const [logoRefreshKey, setLogoRefreshKey] = useState(() => Date.now());
    const [saving, setSaving] = useState(false);

    const setColor = (key) => (value) => handleChange({ target: { name: key, value } });

    const applyPreset = (preset) => {
        handleChange({ target: { name: 'BRAND_PRIMARY_COLOR', value: preset.primary } });
        handleChange({ target: { name: 'BRAND_ACCENT_COLOR', value: preset.accent } });
        handleChange({ target: { name: 'BRAND_THEME_NAME', value: preset.name } });
    };

    const onLogoUploaded = useCallback(() => {
        setLogoRefreshKey(Date.now());
        refetchTheme?.();
    }, [refetchTheme]);

    const handleSaveColors = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await handleSave(e);
            await refetchTheme?.();
        } catch {
            // Failure is already surfaced via handleSave's toast.promise.
        } finally {
            setSaving(false);
        }
    };

    const handleResetDefaults = async () => {
        if (!window.confirm('Reset brand colors to the default "Forson Slate" theme and remove uploaded logos?')) return;
        try {
            Object.entries(DEFAULTS).forEach(([key, value]) => {
                handleChange({ target: { name: key, value } });
            });
            await api.put('/settings', DEFAULTS);
            await Promise.allSettled([
                api.delete('/branding/logo/full'),
                api.delete('/branding/logo/icon'),
            ]);
            setLogoRefreshKey(Date.now());
            await Promise.all([refetchTheme?.(), refetchSettings?.()]);
            toast.success('Brand identity reset to default.');
        } catch {
            toast.error('Failed to reset brand identity.');
        }
    };

    const primary = settings.BRAND_PRIMARY_COLOR || DEFAULTS.BRAND_PRIMARY_COLOR;
    const accent = settings.BRAND_ACCENT_COLOR || '';
    const primaryDark = settings.BRAND_PRIMARY_COLOR_DARK || DEFAULTS.BRAND_PRIMARY_COLOR_DARK;
    const accentDark = settings.BRAND_ACCENT_COLOR_DARK || '';

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">Logo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <LogoUploadWidget
                        variant="full"
                        label="Full logo"
                        hint="Shown on the login page and expanded sidebar. PNG, SVG, or WebP, up to 2MB."
                        refreshKey={logoRefreshKey}
                        onUploaded={onLogoUploaded}
                    />
                    <LogoUploadWidget
                        variant="icon"
                        label="Icon logo"
                        hint="Shown in the collapsed sidebar and browser tab (favicon). A square mark works best."
                        refreshKey={logoRefreshKey}
                        onUploaded={onLogoUploaded}
                    />
                </div>
            </div>

            <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1">Brand colors</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                    Pick a preset or a custom color. Success, warning, and danger colors stay fixed everywhere so status meaning never changes.
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                    {PRESETS.map((preset) => (
                        <button
                            type="button"
                            key={preset.name}
                            onClick={() => applyPreset(preset)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-500 text-xs font-medium text-gray-700 dark:text-slate-200"
                        >
                            <span className="flex -space-x-1">
                                <span className="h-3.5 w-3.5 rounded-full border border-white dark:border-slate-800" style={{ backgroundColor: preset.primary }} />
                                <span className="h-3.5 w-3.5 rounded-full border border-white dark:border-slate-800" style={{ backgroundColor: preset.accent }} />
                            </span>
                            {preset.name}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <ColorSwatchPicker
                        label="Primary color"
                        value={primary}
                        onChange={setColor('BRAND_PRIMARY_COLOR')}
                        presets={PRESETS.map((p) => p.primary)}
                    />
                    <ColorSwatchPicker
                        label="Accent color (optional)"
                        value={accent}
                        onChange={setColor('BRAND_ACCENT_COLOR')}
                        presets={PRESETS.map((p) => p.accent)}
                        allowEmpty
                        emptyLabel="No accent"
                    />
                </div>

                <details className="mt-4">
                    <summary className="text-xs font-medium text-gray-600 dark:text-slate-400 cursor-pointer select-none">
                        Advanced: separate colors for dark mode
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-3">
                        <ColorSwatchPicker
                            label="Primary color (dark mode)"
                            value={primaryDark}
                            onChange={setColor('BRAND_PRIMARY_COLOR_DARK')}
                            presets={PRESETS.map((p) => p.primary)}
                        />
                        <ColorSwatchPicker
                            label="Accent color (dark mode, optional)"
                            value={accentDark}
                            onChange={setColor('BRAND_ACCENT_COLOR_DARK')}
                            presets={PRESETS.map((p) => p.accent)}
                            allowEmpty
                            emptyLabel="No accent"
                        />
                    </div>
                </details>
            </div>

            <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">Live preview</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <PreviewPanel label="Light mode" primary={primary} accent={accent} dark={false} />
                    <PreviewPanel label="Dark mode" primary={primaryDark} accent={accentDark} dark={true} />
                </div>
            </div>

            <div className="pt-4 flex justify-between items-center border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={handleResetDefaults} className="text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200">
                    Reset to default theme
                </button>
                <button
                    type="button"
                    onClick={handleSaveColors}
                    disabled={saving}
                    className="bg-primary-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save Brand Identity'}
                </button>
            </div>
        </div>
    );
};

export default BrandIdentitySettings;
