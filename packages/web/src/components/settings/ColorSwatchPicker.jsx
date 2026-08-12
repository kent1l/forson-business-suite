import React from 'react';
import { contrastRating, contrastRatio, suggestSaferShade, isValidHex } from '../../utils/colorRamp';

const RATING_STYLES = {
    good: { label: 'Good contrast', className: 'text-success-700 bg-success-50 border-success-100' },
    borderline: { label: 'Borderline — best for large text/icons only', className: 'text-warning-700 bg-warning-50 border-warning-100' },
    poor: { label: 'Hard to read as text-on-color', className: 'text-danger-700 bg-danger-50 border-danger-100' },
};

/**
 * A guided brand-color input: preset swatches + custom hex entry + a live
 * WCAG contrast check against white, with a one-click safer-shade suggestion.
 * Never blocks the value from being set - guidance only, per product decision
 * to warn rather than restrict (brand intent should win over auto-correction).
 */
const ColorSwatchPicker = ({ label, value, onChange, presets, allowEmpty = false, emptyLabel = 'None' }) => {
    const hasValue = isValidHex(value);
    const rating = hasValue ? contrastRating(value) : null;
    const ratio = hasValue ? contrastRatio(value, '#ffffff') : null;
    const ratingStyle = rating ? RATING_STYLES[rating] : null;
    const saferShade = rating === 'poor' || rating === 'borderline' ? suggestSaferShade(value) : null;

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{label}</label>

            <div className="flex flex-wrap gap-2 mb-3">
                {allowEmpty && (
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        title={emptyLabel}
                        className={`h-8 w-8 rounded-full border-2 flex items-center justify-center text-gray-400 bg-white dark:bg-slate-800 ${!value ? 'border-primary-600 ring-2 ring-primary-100' : 'border-gray-300 dark:border-slate-600'}`}
                    >
                        <span className="text-xs">—</span>
                    </button>
                )}
                {presets.map((preset) => (
                    <button
                        type="button"
                        key={preset}
                        onClick={() => onChange(preset)}
                        title={preset}
                        style={{ backgroundColor: preset }}
                        className={`h-8 w-8 rounded-full border-2 ${value?.toLowerCase() === preset.toLowerCase() ? 'border-primary-600 ring-2 ring-primary-100' : 'border-white dark:border-slate-700 shadow-sm'}`}
                    />
                ))}
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={hasValue ? value : '#ffffff'}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-9 rounded border border-gray-300 dark:border-slate-600 cursor-pointer bg-transparent"
                />
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={allowEmpty ? emptyLabel : '#2563eb'}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg font-mono text-sm"
                />
            </div>

            {hasValue && ratingStyle && (
                <div className={`mt-2 text-xs rounded-md border px-3 py-2 ${ratingStyle.className}`}>
                    <div className="flex items-center justify-between gap-2">
                        <span>{ratingStyle.label} (contrast {ratio.toFixed(1)}:1 vs. white)</span>
                        {saferShade && (
                            <button
                                type="button"
                                onClick={() => onChange(saferShade)}
                                className="underline font-medium whitespace-nowrap"
                            >
                                Use safer shade
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ColorSwatchPicker;
