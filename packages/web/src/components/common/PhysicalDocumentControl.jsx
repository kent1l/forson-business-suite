import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';

export default function PhysicalDocumentControl({
    context = 'POS',
    workstationId = 'default',
    value = {},
    onChange,
    onTaxRateSelect,
    disabled = false,
    inputRef: externalInputRef,
    className = '',
    required = false,
}) {
    const internalInputRef = useRef(null);
    const inputRef = externalInputRef || internalInputRef;
    const containerRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [options, setOptions] = useState({ series: [], policy: {} });
    const [suggestion, setSuggestion] = useState(null);
    const [suggestionLoading, setSuggestionLoading] = useState(false);

    // Popover state
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [popoverAnchor, setPopoverAnchor] = useState(null);
    const [pendingException, setPendingException] = useState({
        reason: '',
        notes: '',
    });
    const [enteredPendingValue, setEnteredPendingValue] = useState('');

    const recordingMethod = value?.recording_method || null;
    const selectedSeriesId = value?.series_id || null;
    const physicalReceiptNo = value?.physical_receipt_no || '';

    const STORAGE_KEY_PREFIX = 'forson:last_doc_type:';

    const resolveInitialChoiceKey = useCallback((data) => {
        if (!data || !data.choices || data.choices.length === 0) return null;

        // 1. Check local storage for last used type on this page/context
        try {
            const savedChoice = localStorage.getItem(`${STORAGE_KEY_PREFIX}${context}`);
            if (savedChoice && data.choices.some(c => c.key === savedChoice)) {
                return savedChoice;
            }
        } catch {
            // ignore storage error
        }

        // 2. Policy-configured default choice or default series
        if (data.policy?.default_choice && data.choices.some(c => c.key === String(data.policy.default_choice))) {
            return String(data.policy.default_choice);
        }
        if (data.policy?.default_series_id && data.choices.some(c => c.series_id === data.policy.default_series_id)) {
            return String(data.policy.default_series_id);
        }

        // 3. Fallback to first available choice if selection not strictly required
        if (!data.policy?.selection_required && data.choices.length > 0) {
            return data.choices[0].key;
        }

        return null;
    }, [context]);

    // Helper to fetch suggestion for a chosen series
    const fetchSuggestion = useCallback(async (seriesId) => {
        if (!seriesId) return;
        setSuggestionLoading(true);
        try {
            const res = await api.get('/physical-documents/suggestion', {
                params: { series_id: seriesId, context }
            });
            setSuggestion(res.data);
            return res.data;
        } catch (err) {
            console.error('Failed to load number suggestion:', err);
            return null;
        } finally {
            setSuggestionLoading(false);
        }
    }, [context]);

    // Handle user selecting a choice (series or notebook) from dropdown
    const selectChoice = useCallback(async (choiceKey, choicesList = options.choices || [], seriesList = options.series || []) => {
        if (!choiceKey) {
            onChange?.({
                recording_method: null,
                series_id: null,
                physical_receipt_no: '',
                suggestion_token: null,
                exception: null,
            });
            return;
        }

        // Persist choice for this page/context
        try {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}${context}`, choiceKey);
        } catch {
            // ignore storage error
        }

        const choice = choicesList.find(c => c.key === choiceKey);

        if (choiceKey === 'NOTEBOOK' || choice?.recording_method === 'NOTEBOOK') {
            setSuggestion(null);
            setPopoverOpen(false);
            onChange?.({
                recording_method: 'NOTEBOOK',
                series_id: null,
                physical_receipt_no: '',
                suggestion_token: null,
                exception: null,
            });
            return;
        }

        const numericId = parseInt(choice?.series_id || choiceKey, 10);
        if (!numericId) return;

        const foundSeries = seriesList.find(s => s.series_id === numericId);
        const sug = await fetchSuggestion(numericId);

        // Preselect default fallback tax rate if available
        if (foundSeries?.default_tax_rate_id && onTaxRateSelect) {
            onTaxRateSelect(foundSeries.default_tax_rate_id);
        }

        onChange?.({
            recording_method: 'PAPER',
            series_id: numericId,
            physical_receipt_no: sug?.canonical_reference || '',
            suggestion_token: sug?.suggestion_token || null,
            exception: null,
        });
    }, [context, fetchSuggestion, onChange, onTaxRateSelect, options.choices, options.series]);

    // A restored draft carries a stale token and no local suggestion; fetch a fresh one once on mount.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        if (recordingMethod !== 'PAPER' || !selectedSeriesId || !value?.suggestion_token || value?.exception) return;
        fetchSuggestion(selectedSeriesId).then((sug) => {
            if (!sug?.suggestion_token) return;
            onChange?.({
                ...value,
                physical_receipt_no: sug.canonical_reference || '',
                suggestion_token: sug.suggestion_token,
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load options for this context and workstation
    useEffect(() => {
        let mounted = true;
        setLoading(true);
        api.get('/physical-documents/options', {
            params: { context, workstation_id: workstationId }
        })
            .then(res => {
                if (!mounted) return;
                const data = res.data;
                setOptions(data);

                // If pristine, auto-select last used choice on that page or policy default
                if (!value?.recording_method && !value?.series_id) {
                    const initialKey = resolveInitialChoiceKey(data);
                    if (initialKey) {
                        selectChoice(initialKey, data.choices, data.series);
                    }
                }
            })
            .catch(err => {
                console.error('Failed to load physical document options:', err);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => { mounted = false; };
    }, [context, workstationId]);

    // Watch for parent reset: auto-reapply last used type and fetch next suggestion
    useEffect(() => {
        if (loading || !options.choices || options.choices.length === 0) return;
        if (!value?.recording_method && !value?.series_id) {
            const initialKey = resolveInitialChoiceKey(options);
            if (initialKey) {
                selectChoice(initialKey, options.choices, options.series);
            }
        }
    }, [value?.recording_method, value?.series_id, loading, options, resolveInitialChoiceKey, selectChoice]);

    // When text input blurs, check if user changed from original suggestion
    const handleInputBlur = () => {
        if (recordingMethod !== 'PAPER') return;

        const normalized = formatPhysicalReceiptNumber(physicalReceiptNo);
        if (!normalized) return;

        // Compare normalized value with original suggestion
        const originalSuggestion = suggestion?.canonical_reference;
        if (originalSuggestion && normalized !== originalSuggestion) {
            // Did user already confirm this exact exception?
            if (value?.exception && value.exception.entered_reference === normalized) {
                // Already confirmed
                return;
            }

            // Open skip exception popover
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setPopoverAnchor(rect);
            }
            setEnteredPendingValue(normalized);
            setPendingException({
                reason: '',
                notes: '',
            });
            setPopoverOpen(true);
        } else {
            // Reverted back to suggestion
            if (value?.exception) {
                onChange?.({
                    ...value,
                    physical_receipt_no: normalized,
                    exception: null,
                });
            } else if (normalized !== physicalReceiptNo) {
                onChange?.({
                    ...value,
                    physical_receipt_no: normalized,
                });
            }
        }
    };

    // Confirm exception from popover
    const handleConfirmException = () => {
        if (!pendingException.reason) return;

        const originalSuggestion = suggestion?.canonical_reference;
        onChange?.({
            ...value,
            physical_receipt_no: enteredPendingValue,
            exception: {
                reason: pendingException.reason,
                original_suggestion: originalSuggestion,
                entered_reference: enteredPendingValue,
                spoiled_reference: pendingException.reason === 'SPOILED_SUGGESTION' ? originalSuggestion : null,
                notes: pendingException.notes || null,
            },
        });
        setPopoverOpen(false);
    };

    // Cancel / Go back from popover: restore suggested reference
    const handleCancelException = () => {
        const originalSuggestion = suggestion?.canonical_reference || '';
        onChange?.({
            ...value,
            physical_receipt_no: originalSuggestion,
            exception: null,
        });
        setPopoverOpen(false);
        setTimeout(() => {
            inputRef.current?.focus();
        }, 50);
    };

    // Keyboard support inside popover
    useEffect(() => {
        if (!popoverOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelException();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [popoverOpen, suggestion]);

    const activeChoices = options.choices || [];
    const currentSeries = (options.series || []).find(s => s.series_id === selectedSeriesId);
    const isNotebook = recordingMethod === 'NOTEBOOK';

    return (
        <div ref={containerRef} className={`relative flex items-center gap-1 w-full ${className}`}>
            {/* Document Type Dropdown */}
            <select
                value={isNotebook ? 'NOTEBOOK' : (selectedSeriesId ? String(selectedSeriesId) : '')}
                onChange={(e) => selectChoice(e.target.value)}
                disabled={disabled || loading}
                aria-label="Physical document type selection"
                className="w-1/3 min-w-[75px] max-w-[110px] px-2 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
                {options.policy?.selection_required && !selectedSeriesId && !isNotebook && (
                    <option value="">Doc...</option>
                )}
                {activeChoices.map(c => (
                    <option key={c.key} value={c.key} title={c.title}>
                        {c.label}
                    </option>
                ))}
            </select>

            {/* Editable Physical Reference / Number */}
            <div className="flex-1 relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={isNotebook ? 'No physical receipt' : physicalReceiptNo}
                    onChange={(e) => {
                        if (isNotebook) return;
                        const raw = e.target.value.toUpperCase().trim();
                        const known = [...(options.series || [])]
                            .filter(s => s.prefix)
                            .sort((a, b) => b.prefix.length - a.prefix.length);
                        const matched = known.find(s => raw.startsWith(s.prefix.toUpperCase()));
                        // Typed a prefix belonging to another document type: switch to it
                        if (matched && matched.series_id !== selectedSeriesId) {
                            selectChoice(String(matched.series_id));
                            return;
                        }
                        // Prefix is locked to the selected series; only the serial is editable
                        const lockedPrefix = currentSeries?.prefix?.toUpperCase();
                        if (!lockedPrefix) return;
                        const serial = (matched ? raw.slice(lockedPrefix.length) : raw).replace(/\D/g, '');
                        onChange?.({
                            ...value,
                            physical_receipt_no: `${lockedPrefix}-${serial}`,
                        });
                    }}
                    onBlur={handleInputBlur}
                    disabled={disabled || isNotebook || (!selectedSeriesId && !isNotebook)}
                    placeholder={suggestionLoading ? 'Loading...' : (isNotebook ? 'No physical receipt' : 'Receipt no (Ctrl+P)')}
                    className={`w-full px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 ${
                        isNotebook
                            ? 'bg-gray-100 dark:bg-slate-800/60 text-gray-400 dark:text-slate-500 italic border-dashed border-gray-300 dark:border-slate-700'
                            : 'bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 border-gray-300 dark:border-slate-600 focus:ring-primary-500'
                    }`}
                />
                {suggestionLoading && (
                    <div className="absolute right-2 top-2.5">
                        <span className="inline-block w-3 h-3 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
                {!isNotebook && value?.exception?.reason === 'SPOILED_SUGGESTION' && (
                    <p role="status" className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        Suggested receipt {value.exception.spoiled_reference} will be marked spoiled at checkout.
                    </p>
                )}
            </div>

            {/* Anchored Exception Popover Portal */}
            {popoverOpen && popoverAnchor && createPortal(
                <div
                    className="fixed inset-0 z-50 overflow-auto bg-black/20 flex items-start justify-center pt-24"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) handleCancelException();
                    }}
                >
                    <div
                        role="dialog"
                        aria-labelledby="skip-popover-title"
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-5 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-150"
                        style={{
                            maxWidth: '440px',
                        }}
                    >
                        <h3 id="skip-popover-title" className="text-base font-bold text-gray-900 dark:text-slate-100 mb-2">
                            Receipt number changed
                        </h3>

                        <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-lg text-xs space-y-1 mb-4 font-mono">
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-slate-400">Suggested:</span>
                                <span className="font-semibold text-gray-800 dark:text-slate-200">{suggestion?.canonical_reference || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-slate-400">Entered:</span>
                                <span className="font-semibold text-primary-600 dark:text-primary-400">{enteredPendingValue}</span>
                            </div>
                        </div>

                        <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-3">
                            Why was the suggested number not used?
                        </p>

                        <div className="space-y-2.5 mb-4 text-sm">
                            {currentSeries?.method === 'LAST_ISSUED_PLUS_ONE' && (
                                <label className="flex items-start gap-2.5 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="skip_reason"
                                        value="NEW_BOOKLET"
                                        checked={pendingException.reason === 'NEW_BOOKLET'}
                                        onChange={() => setPendingException(prev => ({ ...prev, reason: 'NEW_BOOKLET' }))}
                                        className="mt-0.5 text-primary-600 focus:ring-primary-500"
                                    />
                                    <div>
                                        <span className="font-medium text-gray-900 dark:text-slate-100">New stub / different booklet</span>
                                        <p className="text-xs text-gray-500 dark:text-slate-400">Continuing sequence from entered booklet number.</p>
                                    </div>
                                </label>
                            )}

                            <label className="flex items-start gap-2.5 cursor-pointer">
                                <input
                                    type="radio"
                                    name="skip_reason"
                                    value="SPOILED_SUGGESTION"
                                    checked={pendingException.reason === 'SPOILED_SUGGESTION'}
                                    onChange={() => setPendingException(prev => ({ ...prev, reason: 'SPOILED_SUGGESTION' }))}
                                    className="mt-0.5 text-amber-600 focus:ring-amber-500"
                                />
                                <div>
                                    <span className="font-medium text-gray-900 dark:text-slate-100">Suggested receipt is spoiled</span>
                                    <p className="text-xs text-gray-500 dark:text-slate-400">Mark suggested paper as damaged or unusable.</p>
                                </div>
                            </label>

                            <label className="flex items-start gap-2.5 cursor-pointer">
                                <input
                                    type="radio"
                                    name="skip_reason"
                                    value="OTHER_NOT_SPOILED"
                                    checked={pendingException.reason === 'OTHER_NOT_SPOILED'}
                                    onChange={() => setPendingException(prev => ({ ...prev, reason: 'OTHER_NOT_SPOILED' }))}
                                    className="mt-0.5 text-primary-600 focus:ring-primary-500"
                                />
                                <div>
                                    <span className="font-medium text-gray-900 dark:text-slate-100">Other / not spoiled</span>
                                    <p className="text-xs text-gray-500 dark:text-slate-400">Manual override without spoiling suggested number.</p>
                                </div>
                            </label>
                        </div>

                        {/* Spoilage warning callout */}
                        {pendingException.reason === 'SPOILED_SUGGESTION' && (
                            <div className="p-3 mb-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-200">
                                <strong>Notice:</strong> <code>{suggestion?.canonical_reference}</code> will no longer be suggested or accepted for this series when this transaction posts successfully.
                            </div>
                        )}

                        <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                                Optional note:
                            </label>
                            <input
                                type="text"
                                value={pendingException.notes}
                                onChange={(e) => setPendingException(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="e.g. Booklet #5 jump"
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
                            <button
                                type="button"
                                onClick={handleCancelException}
                                className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                                Go back (Esc)
                            </button>
                            <button
                                type="button"
                                disabled={!pendingException.reason}
                                onClick={handleConfirmException}
                                className="px-4 py-1.5 bg-primary-600 text-white rounded-md text-xs font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
