import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import Modal from '../components/ui/Modal';
import ReplaceChequeModal from '../components/accounts-payable/ReplaceChequeModal';
import DeletePaymentModal from '../components/accounts-payable/DeletePaymentModal';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';

const blankRow = () => ({ date: format(new Date(), 'yyyy-MM-dd'), payee: '', amount: '', memo: '' });

const STATUS_BADGE_CLASS = {
    VOID: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
    REPLACED: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
    DELETED: 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-400',
    BOUNCED: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
    HELD_FOR_RELEASE: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
    ISSUED: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
};
const DEFAULT_STATUS_BADGE_CLASS = 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300';

const BUTTON_BASE = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_SECONDARY = `${BUTTON_BASE} border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700`;
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-primary-600 text-white hover:bg-primary-700`;
const BUTTON_DANGER = `${BUTTON_BASE} border border-danger-200 dark:border-danger-900/50 bg-white dark:bg-slate-800 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20`;
const INPUT_BASE = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/30';

async function decodeBlobError(error, defaultMessage = 'PDF generation failed') {
    if (error?.response?.data instanceof Blob) {
        try {
            const text = await error.response.data.text();
            const parsed = JSON.parse(text);
            return parsed.message || parsed.code || defaultMessage;
        } catch {
            return defaultMessage;
        }
    }
    return error?.response?.data?.message || error?.message || defaultMessage;
}

const ChequePrintingPage = ({ onNavigateSection }) => {
    const { hasPermission } = useAuth();
    const canManageBankAccounts = hasPermission('ap-pdc:view');
    const canManageSettings = hasPermission('cheques:manage_settings');
    const canCreateCheques = hasPermission('cheques:create');

    const [templates, setTemplates] = useState([]);
    const [printerProfiles, setPrinterProfiles] = useState([]);
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');

    // Preset-isolated batch state: map of templateId -> array of rows
    const [batchesByTemplate, setBatchesByTemplate] = useState({});
    // Locally dismissed IDs per preset: map of templateId -> Set of chequeRecordId
    const [dismissedByTemplate, setDismissedByTemplate] = useState({});
    // Row selection for print queue: map of templateId -> Set of rowKey
    const [selectedKeysByTemplate, setSelectedKeysByTemplate] = useState({});
    // Queue pagination cursors per preset: map of templateId -> string | null
    const [cursorsByTemplate, setCursorsByTemplate] = useState({});
    const [hasMoreByTemplate, setHasMoreByTemplate] = useState({});

    // Global queue summary from backend
    const [queueSummary, setQueueSummary] = useState({ total: 0, unassigned_count: 0, by_template: [] });
    const [setupRequiredRecords, setSetupRequiredRecords] = useState([]);
    const [queueLoading, setQueueLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    // PDF recovery state
    const [lastGeneratedPdf, setLastGeneratedPdf] = useState(null);

    // Form controls
    const [saving, setSaving] = useState(false);
    const [persistRecords, setPersistRecords] = useState(true);
    const [testPrintMode, setTestPrintMode] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // History & Modals
    const [history, setHistory] = useState([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyQuery, setHistoryQuery] = useState('');
    const [historyBankFilter, setHistoryBankFilter] = useState('all');
    const [includeDeletedHistory, setIncludeDeletedHistory] = useState(false);
    const [pendingHistoryEntry, setPendingHistoryEntry] = useState(null);
    const [replaceTarget, setReplaceTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    // External print acknowledgement modal
    const [externalPrintTarget, setExternalPrintTarget] = useState(null);
    const [externalPrintNotes, setExternalPrintNotes] = useState('');
    const [externalPrintSaving, setExternalPrintSaving] = useState(false);

    const activeTemplateRef = useRef(selectedTemplateId);
    activeTemplateRef.current = selectedTemplateId;

    const selectedTemplate = useMemo(() => (
        Array.isArray(templates) ? templates.find((tpl) => String(tpl.id) === String(selectedTemplateId)) : undefined
    ), [templates, selectedTemplateId]);

    // Current visible rows for the selected template
    const rows = useMemo(() => {
        if (!selectedTemplateId) return [blankRow()];
        return batchesByTemplate[selectedTemplateId] || [blankRow()];
    }, [batchesByTemplate, selectedTemplateId]);

    const dismissedIdsForCurrentPreset = useMemo(() => {
        if (!selectedTemplateId) return new Set();
        return dismissedByTemplate[selectedTemplateId] || new Set();
    }, [dismissedByTemplate, selectedTemplateId]);

    const activeRows = useMemo(() => (
        rows.filter((row) => row.payee || row.amount || row.memo).map((row) => ({
            ...row,
            amount: String(Math.round(Number(row.amount || 0) * 100) / 100)
        }))
    ), [rows]);

    const getRowKey = useCallback((row, idx) => (
        row.cheque_record_id ? `rec_${row.cheque_record_id}` : `draft_${idx}`
    ), []);

    const selectedKeysForCurrentPreset = selectedKeysByTemplate[selectedTemplateId];

    const isRowSelected = useCallback((row, idx) => {
        if (!selectedKeysForCurrentPreset) return true;
        return selectedKeysForCurrentPreset.has(getRowKey(row, idx));
    }, [selectedKeysForCurrentPreset, getRowKey]);

    const selectedActiveRows = useMemo(() => {
        return activeRows.filter((row, idx) => isRowSelected(row, idx));
    }, [activeRows, isRowSelected]);

    const isAllSelected = activeRows.length > 0 && selectedActiveRows.length === activeRows.length;
    const isIndeterminate = selectedActiveRows.length > 0 && selectedActiveRows.length < activeRows.length;

    const handleSelectRow = useCallback((row, idx) => {
        if (!selectedTemplateId) return;
        const key = getRowKey(row, idx);
        setSelectedKeysByTemplate((prev) => {
            const currentKeys = prev[selectedTemplateId] || new Set(activeRows.map(getRowKey));
            const nextKeys = new Set(currentKeys);
            if (nextKeys.has(key)) {
                nextKeys.delete(key);
            } else {
                nextKeys.add(key);
            }
            return { ...prev, [selectedTemplateId]: nextKeys };
        });
    }, [selectedTemplateId, getRowKey, activeRows]);

    const handleSelectAll = useCallback(() => {
        if (!selectedTemplateId) return;
        setSelectedKeysByTemplate((prev) => ({
            ...prev,
            [selectedTemplateId]: new Set(activeRows.map(getRowKey))
        }));
    }, [selectedTemplateId, activeRows, getRowKey]);

    const handleDeselectAll = useCallback(() => {
        if (!selectedTemplateId) return;
        setSelectedKeysByTemplate((prev) => ({
            ...prev,
            [selectedTemplateId]: new Set()
        }));
    }, [selectedTemplateId]);

    const toggleMasterCheckbox = useCallback(() => {
        if (isAllSelected) {
            handleDeselectAll();
        } else {
            handleSelectAll();
        }
    }, [isAllSelected, handleDeselectAll, handleSelectAll]);

    const normalizeQueueRecordToRow = (record) => ({
        payee: record.payee || '',
        amount: Number(record.amount || 0).toFixed(2),
        date: record.cheque_date ? String(record.cheque_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd'),
        memo: record.memo || '',
        cheque_record_id: record.id,
        cheque_number: record.cheque_number || null,
        bank_name: record.bank_name || record.effective_bank_name || '',
        status: record.status || 'ISSUED',
        sourceTemplateId: record.effective_template_id
    });

    const setRowsForCurrentPreset = useCallback((newRowsOrFn) => {
        if (!selectedTemplateId) return;
        setBatchesByTemplate((prev) => {
            const currentRows = prev[selectedTemplateId] || [blankRow()];
            const nextRows = typeof newRowsOrFn === 'function' ? newRowsOrFn(currentRows) : newRowsOrFn;
            return {
                ...prev,
                [selectedTemplateId]: nextRows.length ? nextRows : [blankRow()]
            };
        });
    }, [selectedTemplateId]);

    // Load initial templates, profiles, and history
    const loadMetadata = async (showDeleted = includeDeletedHistory) => {
        try {
            const [templatesRes, historyRes, profilesRes] = await Promise.all([
                api.get('/cheques/templates'),
                api.get('/cheques/history', { params: { include_deleted: showDeleted ? 'true' : undefined } }),
                api.get('/cheques/printer-profiles')
            ]);
            const templateRows = Array.isArray(templatesRes.data) ? templatesRes.data : (Array.isArray(templatesRes.data?.data) ? templatesRes.data.data : []);
            const profileRows = Array.isArray(profilesRes.data) ? profilesRes.data : (Array.isArray(profilesRes.data?.data) ? profilesRes.data.data : []);
            const historyRows = Array.isArray(historyRes.data) ? historyRes.data : (Array.isArray(historyRes.data?.data) ? historyRes.data.data : []);
            setTemplates(templateRows);
            setHistory(historyRows);
            setPrinterProfiles(profileRows);

            if (!selectedTemplateId && templateRows.length) {
                setSelectedTemplateId(String(templateRows[0].id));
            }
            if (!selectedProfileId && profileRows.length) {
                const defaultProfile = profileRows.find((profile) => profile.is_default) || profileRows[0];
                setSelectedProfileId(String(defaultProfile.id));
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to load cheque module metadata.');
        }
    };

    // Load queue data for a given template ID
    const fetchQueueForTemplate = useCallback(async (templateId, reset = false) => {
        if (!templateId) return;
        setQueueLoading(true);
        try {
            const res = await api.get('/cheques/print-queue', {
                params: {
                    template_id: Number(templateId),
                    limit: 100
                }
            });

            // Prevent race condition if user quickly switched presets
            if (activeTemplateRef.current !== templateId) return;

            const records = res.data?.records || [];
            const summary = res.data?.summary || { total: 0, unassigned_count: 0, by_template: [] };
            const nextCursor = res.data?.next_cursor || null;

            setQueueSummary(summary);
            setCursorsByTemplate((prev) => ({ ...prev, [templateId]: nextCursor }));
            setHasMoreByTemplate((prev) => ({ ...prev, [templateId]: Boolean(nextCursor) }));

            setBatchesByTemplate((prevBatches) => {
                const existing = reset ? [] : (prevBatches[templateId] || []);
                const dismissed = dismissedByTemplate[templateId] || new Set();

                // Preserve standalone rows typed by user
                const standaloneRows = existing.filter((r) => !r.cheque_record_id && (r.payee || r.amount || r.memo));
                const existingQueuedMap = new Map(existing.filter((r) => r.cheque_record_id).map((r) => [r.cheque_record_id, r]));

                const serverIdSet = new Set(records.map((r) => r.id));

                // Reconcile: keep existing queued rows if still present in server results
                const reconciledQueuedRows = [];
                for (const rec of records) {
                    if (dismissed.has(rec.id)) continue;
                    if (existingQueuedMap.has(rec.id)) {
                        reconciledQueuedRows.push(existingQueuedMap.get(rec.id));
                    } else {
                        reconciledQueuedRows.push(normalizeQueueRecordToRow(rec));
                    }
                }

                // If any existing row was voided/replaced/printed server-side, it is excluded
                const combined = [...reconciledQueuedRows, ...standaloneRows];
                return {
                    ...prevBatches,
                    [templateId]: combined.length ? [...combined, blankRow()] : [blankRow()]
                };
            });
        } catch (error) {
            console.error('Failed to fetch print queue', error);
            toast.error(error?.response?.data?.message || 'Failed to load print queue.');
        } finally {
            setQueueLoading(false);
        }
    }, [dismissedByTemplate]);

    // Load unassigned / setup-required queue records
    const fetchSetupRequiredQueue = useCallback(async () => {
        try {
            const res = await api.get('/cheques/print-queue', {
                params: { unassigned: 'true', limit: 100 }
            });
            setSetupRequiredRecords(res.data?.records || []);
        } catch (error) {
            console.error('Failed to fetch unassigned queue', error);
        }
    }, []);

    // Refresh entire queue data and history
    const refreshAll = useCallback(async () => {
        await Promise.all([
            loadMetadata(includeDeletedHistory),
            selectedTemplateId ? fetchQueueForTemplate(selectedTemplateId) : Promise.resolve(),
            fetchSetupRequiredQueue()
        ]);
    }, [includeDeletedHistory, selectedTemplateId, fetchQueueForTemplate, fetchSetupRequiredQueue]);

    useEffect(() => {
        loadMetadata(includeDeletedHistory);
        fetchSetupRequiredQueue();
    }, [includeDeletedHistory, fetchSetupRequiredQueue]);

    useEffect(() => {
        if (selectedTemplateId) {
            fetchQueueForTemplate(selectedTemplateId);
        }
    }, [selectedTemplateId, fetchQueueForTemplate]);

    // Window focus refresh listener
    useEffect(() => {
        const handleFocus = () => {
            if (activeTemplateRef.current) {
                fetchQueueForTemplate(activeTemplateRef.current);
                fetchSetupRequiredQueue();
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [fetchQueueForTemplate, fetchSetupRequiredQueue]);

    // Clean up revoked PDF URL on unmount
    useEffect(() => {
        return () => {
            if (lastGeneratedPdf?.url) {
                URL.revokeObjectURL(lastGeneratedPdf.url);
            }
        };
    }, [lastGeneratedPdf]);

    const handleLoadMore = async () => {
        const cursor = cursorsByTemplate[selectedTemplateId];
        if (!cursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const res = await api.get('/cheques/print-queue', {
                params: {
                    template_id: Number(selectedTemplateId),
                    cursor,
                    limit: 100
                }
            });
            const newRecords = res.data?.records || [];
            const nextCursor = res.data?.next_cursor || null;

            setCursorsByTemplate((prev) => ({ ...prev, [selectedTemplateId]: nextCursor }));
            setHasMoreByTemplate((prev) => ({ ...prev, [selectedTemplateId]: Boolean(nextCursor) }));

            setRowsForCurrentPreset((prev) => {
                const dismissed = dismissedIdsForCurrentPreset;
                const existingIds = new Set(prev.map((r) => r.cheque_record_id).filter(Boolean));
                const toAdd = newRecords
                    .filter((r) => !existingIds.has(r.id) && !dismissed.has(r.id))
                    .map(normalizeQueueRecordToRow);

                const trailing = prev[prev.length - 1];
                const isTrailingBlank = trailing && !trailing.payee && !trailing.amount && !trailing.memo;
                const base = isTrailingBlank ? prev.slice(0, -1) : prev;
                return [...base, ...toAdd, blankRow()];
            });
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to load more cheques.');
        } finally {
            setLoadingMore(false);
        }
    };

    const updateRow = (idx, field, value) => {
        setRowsForCurrentPreset((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            if (idx === next.length - 1 && (next[idx].payee || next[idx].amount || next[idx].memo)) {
                next.push(blankRow());
            }
            return next;
        });
    };

    const removeRow = (idx) => {
        const target = rows[idx];
        if (target?.cheque_record_id) {
            setDismissedByTemplate((prev) => {
                const currentSet = new Set(prev[selectedTemplateId] || []);
                currentSet.add(target.cheque_record_id);
                return { ...prev, [selectedTemplateId]: currentSet };
            });
        }
        const targetKey = getRowKey(target, idx);
        setSelectedKeysByTemplate((prev) => {
            if (!prev[selectedTemplateId]) return prev;
            const nextKeys = new Set(prev[selectedTemplateId]);
            nextKeys.delete(targetKey);
            return { ...prev, [selectedTemplateId]: nextKeys };
        });
        setRowsForCurrentPreset((prev) => {
            if (prev.length === 1) return [blankRow()];
            const next = prev.filter((_, rowIndex) => rowIndex !== idx);
            return next.length ? next : [blankRow()];
        });
    };

    const handleRestoreDismissed = () => {
        if (!selectedTemplateId) return;
        setDismissedByTemplate((prev) => ({
            ...prev,
            [selectedTemplateId]: new Set()
        }));
        setSelectedKeysByTemplate((prev) => {
            const next = { ...prev };
            delete next[selectedTemplateId];
            return next;
        });
        // Re-fetch queue to restore removed entries
        fetchQueueForTemplate(selectedTemplateId, true);
        toast.success('Removed cheques restored to print queue.');
    };

    const handleBulkRemove = () => {
        if (!selectedTemplateId || !selectedActiveRows.length) return;
        const count = selectedActiveRows.length;
        const selectedQueuedIds = selectedActiveRows.map((r) => r.cheque_record_id).filter(Boolean);
        const selectedKeySet = new Set(selectedActiveRows.map(getRowKey));

        if (selectedQueuedIds.length) {
            setDismissedByTemplate((prev) => {
                const currentSet = new Set(prev[selectedTemplateId] || []);
                for (const id of selectedQueuedIds) {
                    currentSet.add(id);
                }
                return { ...prev, [selectedTemplateId]: currentSet };
            });
        }

        setRowsForCurrentPreset((prevRows) => {
            const next = prevRows.filter((row, idx) => !selectedKeySet.has(getRowKey(row, idx)));
            return next.length ? next : [blankRow()];
        });

        // Reset selection for this preset
        setSelectedKeysByTemplate((prev) => {
            const next = { ...prev };
            delete next[selectedTemplateId];
            return next;
        });

        toast.success(`Removed ${count} cheque${count === 1 ? '' : 's'} from this batch.`);
    };

    const validateRow = (row) => {
        if (!row.payee.trim()) return 'Payee is required';
        const amount = Number(row.amount);
        if (Number.isNaN(amount)) return 'Amount must be numeric';
        if (!isValid(parseISO(row.date))) return 'Due date is invalid';
        return null;
    };

    const requestGeneratePdf = () => {
        if (!selectedTemplate) return toast.error('Select a bank preset first.');
        if (!selectedActiveRows.length) {
            if (activeRows.length) {
                return toast.error('Select at least one cheque from the queue to print.');
            }
            return toast.error('Add at least one cheque line.');
        }
        for (const row of selectedActiveRows) {
            const validationError = validateRow(row);
            if (validationError) return toast.error(validationError);
        }
        const mismatched = selectedActiveRows.filter((row) => row.sourceTemplateId && Number(row.sourceTemplateId) !== Number(selectedTemplateId));
        if (mismatched.length) {
            return toast.error(`${mismatched.length} queued cheque(s) were issued for a different bank preset. Remove them or switch to that preset before printing.`);
        }
        setConfirmOpen(true);
    };

    const generatePdf = async (sourceRows = selectedActiveRows, persist = persistRecords, templateOverride = null) => {
        const template = templateOverride || selectedTemplate;
        if (!template) return toast.error('Select a bank preset first.');
        if (!sourceRows.length) return toast.error('Add at least one cheque line.');

        for (const row of sourceRows) {
            const validationError = validateRow(row);
            if (validationError) return toast.error(validationError);
        }

        setSaving(true);
        let pdfBlob = null;
        let pdfBlobUrl = null;
        let pdfFilename = `cheques-${new Date().toISOString().slice(0, 10)}.pdf`;

        try {
            const templateDateFormat = template.date_format || 'MM-dd-yyyy';
            const payloadRows = sourceRows.map((row) => ({
                date: format(parseISO(row.date), templateDateFormat),
                payee: row.payee,
                amount: row.amount,
                memo: row.memo,
                cheque_record_id: row.cheque_record_id || undefined
            }));

            const pdfResponse = await api.post('/cheques/generate-pdf', {
                template_id: Number(template.id),
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

            pdfBlob = new Blob([pdfResponse.data], { type: 'application/pdf' });
            pdfBlobUrl = URL.createObjectURL(pdfBlob);

            // Store in lastGeneratedPdf for recovery
            if (lastGeneratedPdf?.url) {
                URL.revokeObjectURL(lastGeneratedPdf.url);
            }
            setLastGeneratedPdf({
                blob: pdfBlob,
                url: pdfBlobUrl,
                filename: pdfFilename,
                count: sourceRows.length,
                timestamp: new Date()
            });

            // Handle standalone history saving
            const rowsToPersist = sourceRows.filter((row) => !row.cheque_record_id);
            let standaloneSaveError = null;
            if (!testPrintMode && persist && rowsToPersist.length) {
                try {
                    const dbPayloadRows = rowsToPersist.map((row) => ({
                        ...row,
                        payee: (row.payee || '').trim(),
                        memo: (row.memo || '').trim()
                    }));
                    await api.post('/cheques/records', {
                        template_id: Number(template.id),
                        records: dbPayloadRows
                    });
                } catch (persistErr) {
                    console.error('Failed to save standalone cheques to history', persistErr);
                    standaloneSaveError = persistErr;
                }
            }

            if (standaloneSaveError) {
                toast.error('PDF was generated successfully, but saving standalone records to history failed. You can still download the PDF.');
            } else if (!testPrintMode) {
                toast.success('Cheque PDF generated.');
            } else {
                toast.success('Test alignment PDF generated — cheques remain in the queue.');
            }

            // Remove successfully generated linked rows from the active batch
            if (!testPrintMode) {
                const generatedLinkedIds = new Set(sourceRows.map((r) => r.cheque_record_id).filter(Boolean));
                setSelectedKeysByTemplate((prev) => {
                    const next = { ...prev };
                    delete next[selectedTemplateId];
                    return next;
                });
                setRowsForCurrentPreset((prev) => {
                    const filtered = prev.filter((r) => !r.cheque_record_id || !generatedLinkedIds.has(r.cheque_record_id));
                    // If standalone save succeeded, clear standalone rows as well
                    if (!standaloneSaveError && persist) {
                        const remaining = filtered.filter((r) => r.cheque_record_id);
                        return remaining.length ? [...remaining, blankRow()] : [blankRow()];
                    }
                    return filtered.length ? filtered : [blankRow()];
                });
            }

            // Attempt to open in a new tab
            const opened = window.open(pdfBlobUrl, '_blank', 'noopener,noreferrer');
            if (!opened) {
                toast.error('Popup blocked by browser. Use the "Open PDF" or "Download PDF" buttons below.', { duration: 6000 });
            }

            // Refresh queue and history
            await refreshAll();
        } catch (error) {
            console.error('PDF generation error', error);
            const decodedMsg = await decodeBlobError(error, 'PDF generation failed');
            toast.error(decodedMsg);
        } finally {
            setSaving(false);
        }
    };

    const handleReprint = async (entry) => {
        if (['VOID', 'REPLACED', 'DELETED'].includes(entry.status) || entry.is_deleted) {
            return toast.error(`Cannot print a cheque with status ${entry.is_deleted && !['VOID', 'REPLACED', 'DELETED'].includes(entry.status) ? 'HIDDEN' : entry.status}.`);
        }
        const entryTemplate = templates.find((tpl) => String(tpl.id) === String(entry.template_id)) || selectedTemplate;
        if (!entryTemplate) return toast.error('Select a preset for reprint.');
        if (entry.template_id) setSelectedTemplateId(String(entry.template_id));
        await generatePdf([{
            payee: entry.payee,
            amount: Number(entry.amount).toFixed(2),
            date: entry.cheque_date ? String(entry.cheque_date).slice(0, 10) : format(new Date(), 'yyyy-MM-dd'),
            memo: entry.memo || '',
            cheque_record_id: entry.id
        }], false, entryTemplate);
    };

    const handleDeleteOrRemove = async (entry) => {
        const isFinancial = Boolean(entry.ap_payment_id || entry.expense_id || entry.cheque_number);
        if (isFinancial) {
            setDeleteTarget(entry);
            return;
        }
        try {
            await api.delete(`/cheques/history/${entry.id}`);
            toast.success('Standalone print entry removed.');
            await refreshAll();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Remove failed.');
        }
    };

    const handleRestoreVisibility = async (entry) => {
        try {
            await api.post(`/ap/outbound-clearance/${entry.id}/restore`, {
                notes: 'Restored hidden cheque visibility from Print History',
            });
            toast.success(`Cheque #${entry.cheque_number || entry.id} restored.`);
            await refreshAll();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to restore visibility.');
        }
    };

    const handleRecordExternalPrint = async () => {
        if (!externalPrintTarget) return;
        const note = externalPrintNotes.trim();
        if (!note) {
            return toast.error('Please provide a note explaining why this cheque was printed externally.');
        }

        setExternalPrintSaving(true);
        try {
            const res = await api.post(`/cheques/${externalPrintTarget.id}/record-external-print`, {
                notes: note,
                confirmation: true
            });
            if (res.data?.already_recorded) {
                toast(res.data.message || 'Cheque was already recorded.', { icon: 'ℹ️' });
            } else {
                toast.success('Cheque acknowledged as printed externally.');
            }
            setExternalPrintTarget(null);
            setExternalPrintNotes('');
            await refreshAll();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to record external print.');
        } finally {
            setExternalPrintSaving(false);
        }
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
    const selectedCount = selectedActiveRows.length;
    const selectedTotal = selectedActiveRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const dismissedCount = dismissedIdsForCurrentPreset.size;

    const filteredHistory = useMemo(() => {
        const query = historyQuery.trim().toLowerCase();
        return history.filter((entry) => {
            const bank = entry.bank_preset || 'Unassigned';
            const matchesBank = historyBankFilter === 'all' || bank === historyBankFilter;
            if (!matchesBank) return false;
            if (!query) return true;
            return [entry.payee, entry.memo, bank, entry.cheque_number, entry.replaces_cheque_number, entry.replaced_by_cheque_number, String(entry.amount)]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query));
        });
    }, [history, historyQuery, historyBankFilter]);

    const historyBankOptions = useMemo(() => {
        const banks = Array.from(new Set(history.map((entry) => entry.bank_preset).filter(Boolean)));
        return banks.sort((a, b) => a.localeCompare(b));
    }, [history]);

    return (
        <div className="space-y-4 pb-4">
            {/* Header Card */}
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 md:p-5">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-slate-100">Print Cheques</h2>
                        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                            Prepare cheques for printing and review printed cheque history. Bank presets and printer profiles live under Templates &amp; Settings.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className={BUTTON_SECONDARY} onClick={refreshAll} title="Refresh print queue">
                            <Icon path={ICONS.refresh || ICONS.clock} className="h-4 w-4" />
                            Refresh
                        </button>
                        <button className={BUTTON_SECONDARY} onClick={() => setHistoryOpen(true)}>
                            <Icon path={ICONS.history} className="h-4 w-4" />
                            View History
                        </button>
                        <button
                            className={BUTTON_PRIMARY}
                            disabled={saving || (activeRows.length > 0 && selectedCount === 0)}
                            onClick={requestGeneratePdf}
                            title={selectedCount === 0 && activeRows.length > 0 ? 'Select at least one cheque to print' : undefined}
                        >
                            <Icon path={ICONS.receipt} className="h-4 w-4" />
                            {saving ? 'Generating…' : selectedCount > 0 && selectedCount < queueCount ? `Generate PDF (${selectedCount})` : 'Generate PDF'}
                        </button>
                    </div>
                </div>
            </div>

            {/* PDF Recovery Banner */}
            {lastGeneratedPdf && (
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                            <Icon path={ICONS.checkCircle || ICONS.check} className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                                Cheque PDF Generated ({lastGeneratedPdf.count} cheque{lastGeneratedPdf.count === 1 ? '' : 's'})
                            </h3>
                            <p className="text-xs text-emerald-700 dark:text-emerald-300">
                                If your browser blocked opening the new tab, you can open or download the PDF below.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                            className={`${BUTTON_SECONDARY} bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50 dark:bg-slate-800 dark:text-emerald-300 dark:border-emerald-700`}
                            onClick={() => window.open(lastGeneratedPdf.url, '_blank', 'noopener,noreferrer')}
                        >
                            Open PDF
                        </button>
                        <a
                            href={lastGeneratedPdf.url}
                            download={lastGeneratedPdf.filename}
                            className={`${BUTTON_PRIMARY} bg-emerald-600 hover:bg-emerald-700 text-white`}
                        >
                            Download PDF
                        </a>
                    </div>
                </div>
            )}

            {/* Bank Preset Switcher Tabs */}
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Select Bank Preset Queue:</span>
                    <span className="text-xs text-gray-400 dark:text-slate-500">Unfinished drafts are preserved per bank preset</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {templates.map((tpl) => {
                        const isSelected = String(tpl.id) === String(selectedTemplateId);
                        const count = queueSummary?.by_template?.find((b) => Number(b.template_id) === Number(tpl.id))?.count || 0;
                        return (
                            <button
                                key={tpl.id}
                                onClick={() => setSelectedTemplateId(String(tpl.id))}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                                    isSelected
                                        ? 'bg-primary-600 text-white shadow-xs'
                                        : 'bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200'
                                }`}
                            >
                                <span>{tpl.bank_name}</span>
                                {count > 0 && (
                                    <span className={`px-1.5 py-0.2 rounded-full text-xs font-bold ${isSelected ? 'bg-primary-700 text-white' : 'bg-primary-100 text-primary-800 dark:bg-primary-900/60 dark:text-primary-300'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Setup Required Banner */}
            {queueSummary.unassigned_count > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                            <Icon path={ICONS.warning} className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                            <div>
                                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                    Setup Required: {queueSummary.unassigned_count} cheque{queueSummary.unassigned_count === 1 ? '' : 's'} cannot be auto-queued
                                </h3>
                                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                                    These instruments have no active print template configured for their bank account. Configure a default template in Bank Accounts, or acknowledge external printing.
                                </p>
                            </div>
                        </div>
                        {canManageBankAccounts && onNavigateSection && (
                            <button
                                className={`${BUTTON_SECONDARY} text-xs py-1.5 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 shrink-0`}
                                onClick={() => onNavigateSection('bank_accounts')}
                            >
                                Go to Bank Accounts →
                            </button>
                        )}
                    </div>

                    {setupRequiredRecords.length > 0 && (
                        <div className="max-h-48 overflow-auto border border-amber-200/80 dark:border-amber-900/50 rounded-lg bg-white/70 dark:bg-slate-900/40">
                            <table className="w-full text-xs">
                                <thead className="bg-amber-100/50 dark:bg-slate-800 text-amber-900 dark:text-amber-200 sticky top-0">
                                    <tr>
                                        <th className="p-2 text-left">Cheque #</th>
                                        <th className="p-2 text-left">Payee</th>
                                        <th className="p-2 text-right">Amount</th>
                                        <th className="p-2 text-left">Bank Account</th>
                                        <th className="p-2 text-left">Reason</th>
                                        <th className="p-2 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {setupRequiredRecords.map((item) => (
                                        <tr key={item.id} className="border-t border-amber-100 dark:border-slate-800">
                                            <td className="p-2 font-mono font-medium">{item.cheque_number || `#${item.id}`}</td>
                                            <td className="p-2">{item.payee}</td>
                                            <td className="p-2 text-right font-mono">₱{Number(item.amount).toFixed(2)}</td>
                                            <td className="p-2">{item.bank_account_name || item.bank_name || '—'}</td>
                                            <td className="p-2">
                                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                    {item.setup_required_reason === 'TEMPLATE_REQUIRED' ? 'No Default Template' : 'Template Unavailable'}
                                                </span>
                                            </td>
                                            <td className="p-2 text-right">
                                                {canCreateCheques && (
                                                    <button
                                                        className="text-[11px] text-primary-600 hover:text-primary-700 dark:text-primary-400 font-semibold"
                                                        onClick={() => setExternalPrintTarget(item)}
                                                    >
                                                        Record printed elsewhere
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Main Editor Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">
                                Print Queue ({selectedTemplate?.bank_name || 'No Preset'})
                            </h2>
                            {queueLoading && <span className="text-xs text-gray-400 animate-pulse">Syncing…</span>}
                        </div>
                        {queueCount > 0 && (
                            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                                {selectedCount < queueCount ? (
                                    <>
                                        <strong className="text-gray-700 dark:text-slate-300 font-semibold">{selectedCount}</strong> of {queueCount} cheques selected · <span className="font-semibold text-gray-700 dark:text-slate-300 font-mono">₱{selectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </>
                                ) : (
                                    <>
                                        {queueCount} cheque{queueCount === 1 ? '' : 's'} included · <span className="font-semibold text-gray-700 dark:text-slate-300 font-mono">₱{queueTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </>
                                )}
                            </span>
                        )}
                    </div>

                    {/* Restore Dismissed Banner */}
                    {dismissedCount > 0 && (
                        <div className="flex items-center justify-between text-xs bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded-lg p-2.5">
                            <span className="text-gray-600 dark:text-slate-300">
                                {dismissedCount} cheque{dismissedCount === 1 ? '' : 's'} removed from this mount batch (remains pending in database).
                            </span>
                            <button
                                className="text-primary-600 dark:text-primary-400 hover:underline font-semibold"
                                onClick={handleRestoreDismissed}
                            >
                                Restore removed cheques
                            </button>
                        </div>
                    )}

                    {/* Bulk Selection / Actions Toolbar */}
                    {activeRows.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-gray-50 dark:bg-slate-700/40 rounded-xl text-xs border border-gray-200 dark:border-slate-700">
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 dark:text-slate-300 select-none">
                                    <input
                                        type="checkbox"
                                        className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 h-4 w-4 cursor-pointer"
                                        checked={isAllSelected}
                                        ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                                        onChange={toggleMasterCheckbox}
                                    />
                                    <span>Select all ({activeRows.length})</span>
                                </label>
                                {selectedCount > 0 && (
                                    <button
                                        type="button"
                                        className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:underline"
                                        onClick={handleDeselectAll}
                                    >
                                        Deselect all
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2.5">
                                <span className="text-gray-500 dark:text-slate-400">
                                    <strong className="text-gray-800 dark:text-slate-200">{selectedCount}</strong> of {queueCount} selected · <span className="font-mono font-semibold text-gray-800 dark:text-slate-200">₱{selectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </span>
                                {selectedCount > 0 && (
                                    <button
                                        type="button"
                                        className="flex items-center gap-1.5 px-2.5 py-1 text-danger-700 bg-danger-50 hover:bg-danger-100 dark:bg-danger-950/40 dark:text-danger-400 dark:hover:bg-danger-900/50 border border-danger-200 dark:border-danger-800 rounded-lg font-medium transition-colors cursor-pointer"
                                        onClick={handleBulkRemove}
                                        title="Remove selected cheques from this batch (remains pending in database)"
                                    >
                                        <Icon path={ICONS.trash} className="h-3.5 w-3.5" />
                                        <span>Remove selected ({selectedCount})</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="hidden md:grid grid-cols-[48px_160px_1fr_160px_1fr_90px] gap-3 px-2 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                        <div className="flex items-center justify-center">
                            <input
                                type="checkbox"
                                className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 h-4 w-4 cursor-pointer"
                                checked={isAllSelected}
                                ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                                onChange={toggleMasterCheckbox}
                                disabled={activeRows.length === 0}
                                title={isAllSelected ? 'Deselect all cheques' : 'Select all cheques'}
                            />
                        </div>
                        <span>Date</span>
                        <span>Payee</span>
                        <span>Amount</span>
                        <span>Memo</span>
                        <span className="text-right">Actions</span>
                    </div>

                    {rows.map((row, idx) => {
                        const isTrailingBlank = idx === rows.length - 1 && !row.payee && !row.amount && !row.memo;
                        const isQueued = Boolean(row.cheque_record_id);
                        return (
                            <div key={idx} className={`border rounded-xl p-3 grid grid-cols-1 md:grid-cols-[48px_160px_1fr_160px_1fr_90px] gap-3 md:items-center transition-colors ${isTrailingBlank ? 'border-dashed border-gray-300 dark:border-slate-700 bg-transparent' : isQueued ? 'border-primary-200 dark:border-primary-900/50 bg-primary-50/40 dark:bg-primary-900/10' : 'border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/40'}`}>
                                {/* Mobile inclusion toggle */}
                                {!isTrailingBlank && (
                                    <div className="flex md:hidden items-center justify-between pb-2 border-b border-gray-100 dark:border-slate-700/60">
                                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700 dark:text-slate-300 select-none">
                                            <input
                                                type="checkbox"
                                                className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 h-4 w-4 cursor-pointer"
                                                checked={isRowSelected(row, idx)}
                                                onChange={() => handleSelectRow(row, idx)}
                                            />
                                            <span>Include in print batch</span>
                                        </label>
                                        {isQueued && (
                                            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">
                                                AP Cheque
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="hidden md:flex items-center justify-center gap-1.5">
                                    {!isTrailingBlank && (
                                        <>
                                            <input
                                                type="checkbox"
                                                className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 h-4 w-4 cursor-pointer shrink-0"
                                                checked={isRowSelected(row, idx)}
                                                onChange={() => handleSelectRow(row, idx)}
                                                title={isRowSelected(row, idx) ? 'Uncheck to exclude from PDF' : 'Check to include in PDF'}
                                            />
                                            <span
                                                className={`h-5 w-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${isQueued ? 'bg-primary-600 text-white' : 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-400'}`}
                                                title={isQueued ? `Cheque #${row.cheque_number || row.cheque_record_id} issued from Treasury` : undefined}
                                            >
                                                {isQueued ? <Icon path={ICONS.bank} className="h-3 w-3" /> : idx + 1}
                                            </span>
                                        </>
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
                                                    disabled={isQueued}
                                                    title={isQueued ? 'Authoritative amount from payment record' : undefined}
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
                                                disabled={isQueued}
                                                title={isQueued ? 'Authoritative value from payment record' : undefined}
                                            />
                                        )}
                                    </div>
                                ))}
                                <div className="flex md:justify-end gap-1.5 items-center">
                                    {isTrailingBlank ? (
                                        <span className="hidden md:inline text-xs text-gray-400 dark:text-slate-500">Start typing to add</span>
                                    ) : (
                                        <>
                                            {isQueued && canCreateCheques && (
                                                <button
                                                    className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                                                    onClick={() => setExternalPrintTarget({ id: row.cheque_record_id, payee: row.payee, amount: row.amount, cheque_number: row.cheque_number })}
                                                    title="Record printed elsewhere (acknowledgement)"
                                                >
                                                    <Icon path={ICONS.checkCircle || ICONS.check} className="h-4 w-4" />
                                                </button>
                                            )}
                                            <button
                                                className={BUTTON_DANGER}
                                                onClick={() => removeRow(idx)}
                                                disabled={rows.length === 1}
                                                title={isQueued ? 'Remove from this batch (remains pending in database)' : 'Remove this draft cheque'}
                                            >
                                                <Icon path={ICONS.trash} className="h-4 w-4" />
                                                <span className="md:hidden">Remove</span>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Pagination Load More Button */}
                    {hasMoreByTemplate[selectedTemplateId] && (
                        <div className="pt-2 text-center">
                            <button
                                className={BUTTON_SECONDARY}
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                            >
                                {loadingMore ? 'Loading more…' : 'Load more pending cheques'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Print Controls Sidebar */}
                <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Print Controls</h2>
                    <div className="space-y-3">
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                <Icon path={ICONS.bank} className="h-3.5 w-3.5" /> Bank preset
                                <InfoTip label="Bank preset">
                                    A saved layout (field positions, date format, amount wording, paper size) that tells the system exactly where to print each piece of text on a specific bank's cheque stock.
                                </InfoTip>
                            </label>
                            <select className={INPUT_BASE} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                                {!templates.length && <option value="">No bank preset yet</option>}
                                {templates.map((template) => (
                                    <option key={template.id} value={template.id}>{template.bank_name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                <Icon path={ICONS.settings} className="h-3.5 w-3.5" /> Printer profile
                            </label>
                            <select className={INPUT_BASE} value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                                <option value="">{printerProfiles.length ? 'None' : 'No printer profile yet'}</option>
                                {printerProfiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.profile_name}{profile.is_default ? ' (Default)' : ''}</option>
                                ))}
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
                        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                className="rounded text-primary-600 focus:ring-primary-500 mt-0.5"
                                checked={persistRecords}
                                onChange={(e) => setPersistRecords(e.target.checked)}
                            />
                            <div>
                                <span>Save standalone cheques to history</span>
                                <p className="text-[11px] text-gray-400 dark:text-slate-500">
                                    Linked cheques (AP or Expenses) are always recorded in history and audit logs automatically.
                                </p>
                            </div>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
                            <input
                                type="checkbox"
                                className="rounded text-primary-600 focus:ring-primary-500"
                                checked={testPrintMode}
                                onChange={(e) => setTestPrintMode(e.target.checked)}
                            />
                            <span>Test print mode</span>
                            <InfoTip label="Test print mode">
                                Watermarks the PDF and logs TEST_PDF_GENERATED without marking the cheque printed — use this to check alignment on plain paper before committing to real cheque stock.
                            </InfoTip>
                        </label>
                    </div>

                    <p className="text-xs text-gray-400 dark:text-slate-500 flex items-start gap-1.5">
                        <Icon path={ICONS.info} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        Use 100% print scale for proper cheque alignment.
                    </p>
                </div>
            </div>

            {/* History Modal */}
            <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="Cheque History" maxWidth="max-w-6xl">
                <div className="space-y-4">
                    <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">Review past cheque records, replacement chains, and reprint or replace as needed.</p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                        <div className="relative md:col-span-2">
                            <Icon path={ICONS.search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-slate-500" />
                            <input
                                className={`${INPUT_BASE} pl-9`}
                                placeholder="Search payee, cheque #, replacement #, memo, amount or bank"
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
                        <div className="flex items-center justify-between md:justify-end gap-3 text-xs text-gray-600 dark:text-slate-400">
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={includeDeletedHistory}
                                    onChange={(e) => setIncludeDeletedHistory(e.target.checked)}
                                    className="rounded text-primary-600 focus:ring-primary-500"
                                />
                                <span>Include deleted</span>
                            </label>
                            <span>{filteredHistory.length} of {history.length}</span>
                        </div>
                    </div>

                    <div className="max-h-[55vh] overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 sticky top-0">
                                <tr className="text-gray-700 dark:text-slate-300">
                                    <th className="p-2 text-left">Created</th>
                                    <th className="p-2 text-left">Payee</th>
                                    <th className="p-2 text-left">Amount</th>
                                    <th className="p-2 text-left">Bank</th>
                                    <th className="p-2 text-left">Cheque #</th>
                                    <th className="p-2 text-left">Status</th>
                                    <th className="p-2 text-left">Cheque Date</th>
                                    <th className="p-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-700 dark:text-slate-300">
                                {filteredHistory.map((entry) => {
                                    const isHiddenLegacy = Boolean(entry.is_deleted && entry.status !== 'DELETED');
                                    const isFinancial = Boolean(entry.ap_payment_id || entry.expense_id || entry.cheque_number);
                                    const blockedPrint = ['VOID', 'REPLACED', 'DELETED'].includes(entry.status) || isHiddenLegacy;
                                    const canReplace = isFinancial && !['CLEARED', 'VOID', 'REPLACED', 'DELETED'].includes(entry.status);
                                    return (
                                        <tr key={entry.id} className={`border-t border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 ${entry.status === 'DELETED' ? 'opacity-60' : ''}`}>
                                            <td className="p-2 whitespace-nowrap text-xs">{format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm')}</td>
                                            <td className="p-2 font-medium">{entry.payee}</td>
                                            <td className="p-2 font-mono">{entry.amount}</td>
                                            <td className="p-2 text-xs">{entry.bank_account_name || entry.bank_preset || '-'}</td>
                                            <td className="p-2 font-mono whitespace-nowrap">
                                                <div className="flex flex-col gap-0.5">
                                                    <span>{entry.cheque_number || '-'}</span>
                                                    {entry.replaces_cheque_number && (
                                                        <span className="text-[10px] font-sans text-primary-700 dark:text-primary-400">
                                                            ↳ Replaces #{entry.replaces_cheque_number}
                                                        </span>
                                                    )}
                                                    {entry.replaced_by_cheque_number && (
                                                        <span className="text-[10px] font-sans text-warning-700 dark:text-warning-400">
                                                            → Replaced by #{entry.replaced_by_cheque_number}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-2">
                                                <div className="flex flex-col items-start gap-1">
                                                    {entry.status && (
                                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_BADGE_CLASS[entry.status] || DEFAULT_STATUS_BADGE_CLASS}`}>
                                                            {entry.status}
                                                        </span>
                                                    )}
                                                    {isHiddenLegacy && (
                                                        <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                                            Hidden in Print History
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-2 whitespace-nowrap font-mono text-xs">{entry.cheque_date ? String(entry.cheque_date).slice(0, 10) : '-'}</td>
                                            <td className="p-2 text-right space-x-1.5 whitespace-nowrap">
                                                {canReplace && (
                                                    <button className={BUTTON_SECONDARY} onClick={() => setReplaceTarget(entry)} title="Replace cheque (change date, bank, or cheque number)">
                                                        ⟳ Replace
                                                    </button>
                                                )}
                                                {isHiddenLegacy && (
                                                    <button className={BUTTON_SECONDARY} onClick={() => handleRestoreVisibility(entry)} title="Restore visibility in Print History">
                                                        👁️ Restore
                                                    </button>
                                                )}
                                                <button
                                                    className={BUTTON_SECONDARY}
                                                    onClick={() => handleReprint(entry)}
                                                    disabled={blockedPrint}
                                                    title={blockedPrint ? `Cannot print a ${isHiddenLegacy ? 'hidden' : entry.status} cheque` : undefined}
                                                >
                                                    <Icon path={ICONS.history} className="h-4 w-4" />Reprint
                                                </button>
                                                {entry.status !== 'DELETED' && (
                                                    <button className={BUTTON_DANGER} onClick={() => handleDeleteOrRemove(entry)}>
                                                        <Icon path={ICONS.trash} className="h-4 w-4" />
                                                        {isFinancial ? 'Delete Payment' : 'Remove Entry'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {!filteredHistory.length && (
                            <div className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">No cheque history matches the current filters.</div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* External Print Acknowledgement Modal */}
            <Modal
                isOpen={Boolean(externalPrintTarget)}
                onClose={() => setExternalPrintTarget(null)}
                title="Record Cheque as Printed Elsewhere"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                        Acknowledge that physical cheque stock was prepared and released outside this application (e.g., handwritten or typed on manual machinery).
                    </p>
                    {externalPrintTarget && (
                        <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg space-y-1 text-xs">
                            <div><span className="font-semibold text-gray-700 dark:text-slate-300">Cheque #:</span> {externalPrintTarget.cheque_number || `#${externalPrintTarget.id}`}</div>
                            <div><span className="font-semibold text-gray-700 dark:text-slate-300">Payee:</span> {externalPrintTarget.payee}</div>
                            <div><span className="font-semibold text-gray-700 dark:text-slate-300">Amount:</span> ₱{Number(externalPrintTarget.amount).toFixed(2)}</div>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">
                            Reason / Notes <span className="text-danger-500">*</span>
                        </label>
                        <textarea
                            className={`${INPUT_BASE} resize-none h-20`}
                            placeholder="e.g. Prepared manually on pre-printed company cheque leaf"
                            value={externalPrintNotes}
                            onChange={(e) => setExternalPrintNotes(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end pt-2">
                        <button className={BUTTON_SECONDARY} onClick={() => setExternalPrintTarget(null)}>Cancel</button>
                        <button
                            className={BUTTON_PRIMARY}
                            disabled={externalPrintSaving || !externalPrintNotes.trim()}
                            onClick={handleRecordExternalPrint}
                        >
                            {externalPrintSaving ? 'Recording…' : 'Confirm Acknowledgement'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Replace Cheque Modal */}
            <ReplaceChequeModal
                isOpen={Boolean(replaceTarget)}
                onClose={() => setReplaceTarget(null)}
                chequeRecordId={replaceTarget?.id}
                apPaymentId={replaceTarget?.ap_payment_id}
                initialData={replaceTarget}
                onReplaced={() => refreshAll()}
                onPrintReplacement={(newItem) => handleReprint({
                    ...newItem,
                    id: newItem.cheque_record_id || newItem.id,
                })}
            />

            {/* Delete Payment Modal */}
            <DeletePaymentModal
                isOpen={Boolean(deleteTarget)}
                onClose={() => setDeleteTarget(null)}
                chequeRecordId={deleteTarget?.id}
                apPaymentId={deleteTarget?.ap_payment_id}
                initialData={deleteTarget}
                onDeleted={() => refreshAll()}
                onSwitchToReplace={(target) => {
                    const current = deleteTarget;
                    setDeleteTarget(null);
                    setReplaceTarget({ ...current, ...target });
                }}
            />

            {/* Confirmation Modal */}
            <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm cheque batch">
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                        You are about to generate <span className="font-semibold text-gray-800 dark:text-slate-200">{selectedCount} cheque{selectedCount === 1 ? '' : 's'}</span> totaling{' '}
                        <span className="font-mono font-semibold text-gray-800 dark:text-slate-200">₱{selectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>{' '}
                        using preset <span className="font-semibold text-gray-800 dark:text-slate-200">{selectedTemplate?.bank_name || '—'}</span>.
                    </p>
                    <div className="max-h-64 overflow-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 sticky top-0">
                                <tr className="text-gray-700 dark:text-slate-300">
                                    <th className="p-2 text-left"></th>
                                    <th className="p-2 text-left">Date</th>
                                    <th className="p-2 text-left">Payee</th>
                                    <th className="p-2 text-right">Amount</th>
                                    <th className="p-2 text-left">Memo</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-700 dark:text-slate-300">
                                {selectedActiveRows.map((row, idx) => (
                                    <tr key={idx} className="border-t border-gray-200 dark:border-slate-700">
                                        <td className="p-2">
                                            {row.cheque_record_id && (
                                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-400" title="Issued from Treasury">AP</span>
                                            )}
                                        </td>
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
                            Test print mode is on — cheques will be watermarked and remain in the queue as unprinted.
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2 justify-end">
                        <button className={BUTTON_SECONDARY} onClick={() => setConfirmOpen(false)}>Cancel</button>
                        <button className={BUTTON_PRIMARY} disabled={saving} onClick={() => { setConfirmOpen(false); generatePdf(selectedActiveRows); }}>
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
