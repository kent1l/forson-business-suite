import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useTypeahead from '../hooks/useTypeahead';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import Combobox from '../components/ui/Combobox';
import { ICONS } from '../constants';
import useDraft from '../hooks/useDraft';
import useDeepLink from '../hooks/useDeepLink';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import { enrichPartsArray } from '../helpers/applicationCache';
import GoodsReceiptModals from '../components/ui/GoodsReceiptModals';
import MathExpressionInput from '../components/ui/MathExpressionInput';
import DiscountInput from '../components/ui/DiscountInput';
import FreightAllocationWizard from '../components/goods-receipt/FreightAllocationWizard';
import ReturnLineModal from '../components/goods-receipt/ReturnLineModal';
import { formatCurrency } from '../utils/currency';
import { computeCosting, markupFromPrice, DEFAULT_MARKUP_PERCENT, MIN_MARKUP_PERCENT, METHOD_A } from '../utils/grnCosting';
import { useAuth } from '../contexts/AuthContext';

const GoodsReceiptPage = ({ user, onNavigate, pageState }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const resultsId = 'goods-receipt-search-results';
    const inputId = 'goods-receipt-search-input';
    const searchInputRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const handleRapidScan = useCallback(async (rawValue) => {
        const term = (rawValue ?? searchTerm).trim();
        if (!term) return;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        setSearchResults([]);
        try {
            const response = await api.get(`/parts/barcode/${encodeURIComponent(term)}`);
            const enriched = await enrichPartsArray([response.data]);
            addPartToLines(enriched[0]);
        } catch (err) {
            if (err.response?.status === 404) {
                toast.error(`No item found for barcode "${term}".`);
            } else {
                console.error(err);
            }
        }
    }, [searchTerm]);

    const { getInputProps, getItemProps, reset } = useTypeahead({
        items: searchResults,
        onSelect: (item) => { addPartToLines(item); setSearchResults([]); },
        onEnterUnselected: handleRapidScan,
        inputRef: searchInputRef,
        inputId,
        listboxId: resultsId
    });
    const [loading, setLoading] = useState(true);
    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
    const [isNewPartModalOpen, setIsNewPartModalOpen] = useState(false);
    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);
    const [isEditPartModalOpen, setIsEditPartModalOpen] = useState(false);
    const [currentEditPart, setCurrentEditPart] = useState(null);
    const [openPOs, setOpenPOs] = useState([]);
    const [selectedPO, setSelectedPO] = useState('');
    const [posting, setPosting] = useState(false);
    const [receiptDate, setReceiptDate] = useState('');
    const [isBackfill, setIsBackfill] = useState(false);
    const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const { hasPermission } = useAuth();
    // Freight, discounts and the price-sync choice belong to the document as a whole,
    // not to any one line.
    const [freightAmount, setFreightAmount] = useState(0);
    const [freightSupplierId, setFreightSupplierId] = useState('');
    const [freightMethod, setFreightMethod] = useState(METHOD_A);
    const [overallDiscount, setOverallDiscount] = useState({ percent: null, amount: null });
    const [syncRetailPrices, setSyncRetailPrices] = useState(true);
    const [isFreightWizardOpen, setIsFreightWizardOpen] = useState(false);
    const [returnTargetLine, setReturnTargetLine] = useState(null);
    // Set once this receipt exists as a staged goods_receipt row rather than a local form.
    const [stagedGrn, setStagedGrn] = useState(null);
    const [savingDraftRow, setSavingDraftRow] = useState(false);

    const canSubmit = hasPermission('goods_receipt:submit');
    const canPost = hasPermission('goods_receipt:post');

    // Reusable draft hook
    const draftData = useMemo(() => (stagedGrn ? {} : {
        selectedSupplier, lines, selectedPO,
        freightAmount, freightSupplierId, freightMethod, overallDiscount, syncRetailPrices,
    }), [stagedGrn, selectedSupplier, lines, selectedPO, freightAmount, freightSupplierId, freightMethod, overallDiscount, syncRetailPrices]);
    const isEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0) && !d?.selectedPO), []);
    const { status: draftStatus, lastSavedAt, draft, loaded: draftLoaded, clearDraft } = useDraft('goods-receipt', { data: draftData, isEmpty, debounceMs: 750 });

    // The same module the API uses, generated from it, so what is shown here is exactly
    // what will be posted. Recomputed on every keystroke rather than fetched.
    const costing = useMemo(() => computeCosting({
        lines,
        freightAmount,
        freightMethod,
        overallDiscountPercent: overallDiscount.percent,
        overallDiscountAmount: overallDiscount.amount,
        recomputeSalePrice: false,
    }), [lines, freightAmount, freightMethod, overallDiscount]);

    const costingByPart = useMemo(() => {
        const map = new Map();
        lines.forEach((l, i) => map.set(l.part_id, costing.lines[i]));
        return map;
    }, [lines, costing]);

    const totals = useMemo(() => ({
        ...costing.totals,
        lineCount: lines.length,
        totalQuantity: lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0), 0),
        totalSaleValue: costing.lines.reduce((sum, l) => sum + l.accepted_quantity * (l.sale_price || 0), 0),
    }), [costing, lines]);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }

        const fetchSearchResults = async () => {
            try {
                const response = await api.get('/power-search/parts', {
                    params: { keyword: searchTerm }
                });
                const enriched = await enrichPartsArray(response.data || []);
                setSearchResults(enriched);
            } catch {
                toast.error("Search failed.");
            }
        };

        searchDebounceRef.current = setTimeout(fetchSearchResults, 300);
        return () => clearTimeout(searchDebounceRef.current);
    }, [searchTerm]);

    // Application text formatting is handled by the helper

    const fetchInitialData = async () => {
        try {
            setLoading(true);
            const [suppliersRes, brandsRes, groupsRes, openPOsRes] = await Promise.all([
                api.get('/suppliers'),
                api.get('/brands'),
                api.get('/groups'),
                api.get('/purchase-orders/open')
            ]);
            setSuppliers(suppliersRes.data);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
            // Only keep POs that are in the 'Ordered' status for the Goods Receipt selector
            setOpenPOs((openPOsRes.data || []).filter(p => p.status === 'Ordered'));
        } catch {
            toast.error("Failed to load initial data.");
        } finally {
            setLoading(false);
        }
    };

    const fetchSuppliers = async () => {
        const response = await api.get('/suppliers');
        setSuppliers(response.data);
        return response.data;
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    // Arrives when the expense guardrail decides an entry was really a stock
    // purchase. Only the vendor and the wording carry over — the parts, quantities
    // and unit costs were never in the original sentence, so the user supplies them.
    const [expensePrefill, setExpensePrefill] = useState(null);
    useDeepLink(pageState, ({ expensePrefill: incoming, grnId }) => {
        if (grnId) loadStagedReceipt(grnId);
        if (!incoming) return;
        setExpensePrefill(incoming);
        if (incoming.description) setSearchTerm('');
    });

    // Reopen a staged receipt from the review queue, header and lines together, so the
    // reviewer sees exactly the document that was saved rather than a form rebuilt from
    // its lines with the freight and discounts lost.
    const loadStagedReceipt = useCallback(async (grnId) => {
        try {
            const [headerRes, linesRes] = await Promise.all([
                api.get(`/goods-receipts/${grnId}`),
                api.get(`/goods-receipts/${grnId}/lines`),
            ]);
            const header = headerRes.data;
            setStagedGrn({
                grn_id: header.grn_id,
                grn_number: header.grn_number,
                workflow_status: header.workflow_status,
            });
            setSelectedSupplier(String(header.supplier_id));
            setFreightAmount(Number(header.freight_amount) || 0);
            setFreightSupplierId(header.freight_supplier_id ? String(header.freight_supplier_id) : '');
            setFreightMethod(header.freight_allocation_method || METHOD_A);
            setOverallDiscount({
                percent: header.overall_discount_percent != null ? Number(header.overall_discount_percent) : null,
                amount: header.overall_discount_amount != null ? Number(header.overall_discount_amount) : null,
            });
            setSyncRetailPrices(header.sync_retail_prices !== false);
            setIsBackfill(!!header.is_backfill);
            setSupplierInvoiceNo(header.supplier_invoice_no || '');
            if (header.receipt_date) setReceiptDate(String(header.receipt_date).slice(0, 10));
            setLines((linesRes.data || []).map(l => ({
                ...l,
                quantity: Number(l.quantity),
                cost_price: Number(l.cost_price),
                sale_price: l.sale_price != null ? Number(l.sale_price) : null,
                line_discount_percent: l.line_discount_percent != null ? Number(l.line_discount_percent) : null,
                line_discount_amount: l.line_discount_amount != null ? Number(l.line_discount_amount) : null,
                override_freight_amount: l.override_freight_amount != null ? Number(l.override_freight_amount) : null,
                effective_markup_percent: l.effective_markup_percent != null ? Number(l.effective_markup_percent) : DEFAULT_MARKUP_PERCENT,
                return_quantity: Number(l.return_quantity) || 0,
            })));
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Could not open that receipt.');
        }
    }, []);

    useEffect(() => {
        if (!expensePrefill?.payee || suppliers.length === 0 || selectedSupplier) return;
        const wanted = expensePrefill.payee.trim().toLowerCase();
        const hit = suppliers.find(s => (s.supplier_name || '').trim().toLowerCase() === wanted)
            || suppliers.find(s => (s.supplier_name || '').toLowerCase().includes(wanted));
        if (hit) setSelectedSupplier(String(hit.supplier_id));
    }, [expensePrefill, suppliers, selectedSupplier]);

    // When draft loads, hydrate local state once
    useEffect(() => {
        if (!draftLoaded) return;
        if (draft) {
            if (draft.selectedSupplier) setSelectedSupplier(draft.selectedSupplier);
            if (draft.lines) setLines(draft.lines);
            if (draft.selectedPO) setSelectedPO(draft.selectedPO);
            if (draft.freightAmount) setFreightAmount(draft.freightAmount);
            if (draft.freightSupplierId) setFreightSupplierId(draft.freightSupplierId);
            if (draft.freightMethod) setFreightMethod(draft.freightMethod);
            if (draft.overallDiscount) setOverallDiscount(draft.overallDiscount);
            if (draft.syncRetailPrices !== undefined) setSyncRetailPrices(draft.syncRetailPrices);
            toast('Loaded your saved draft.', { icon: '📄' });
        }
    }, [draftLoaded, draft]);

    const handleSelectPO = async (poId) => {
        if (!poId) {
            setSelectedPO('');
            setSelectedSupplier('');
            setLines([]);
            return;
        }
        const po = openPOs.find(p => p.po_id === parseInt(poId));
        setSelectedPO(po);
        setSelectedSupplier(po.supplier_id);

        try {
            toast.loading('Loading PO items...');
            const response = await api.get(`/purchase-orders/${poId}/lines`);
            // Ensure sale_price exists on each line; default to part's last_sale_price if present
            const linesWithSale = response.data.map(l => ({
                ...l,
                cost_price: typeof l.cost_price !== 'undefined' ? l.cost_price : (l.last_cost || 0),
                sale_price: typeof l.sale_price !== 'undefined' ? l.sale_price : (l.last_sale_price || 0)
            }));
            setLines(linesWithSale);
            toast.dismiss();
        } catch {
            toast.dismiss();
            toast.error('Failed to load PO items.');
        }
    };


    const handleNewSupplierSave = async (supplierData) => {
        const promise = api.post('/suppliers', supplierData);
        toast.promise(promise, {
            loading: 'Saving supplier...',
            success: (response) => {
                const newSupplier = response.data;
                fetchSuppliers().then(() => {
                    setSelectedSupplier(newSupplier.supplier_id);
                });
                setIsSupplierModalOpen(false);
                return 'Supplier saved successfully!';
            },
            error: 'Failed to save supplier.',
        });
    };

    const handleSaveNewPart = (partData) => {
        const payload = { ...partData, created_by: user.employee_id };
        const promise = api.post('/parts', payload);

        toast.promise(promise, {
            loading: 'Saving new part...',
            success: (response) => {
                const newPart = response.data;
                setIsNewPartModalOpen(false);
                addPartToLines(newPart);
                return 'Part created successfully!';
            },
            error: 'Failed to save part.'
        });
    };

    const handleEditPartSave = (partData) => {
        const payload = { ...partData };
        const promise = api.put(`/parts/${currentEditPart.part_id}`, payload);

        toast.promise(promise, {
            loading: 'Updating part...',
            success: (response) => {
                const updatedPart = response.data;
                setIsEditPartModalOpen(false);
                setCurrentEditPart(null);
                // Update the line with the new part data
                setLines(lines.map(line =>
                    line.part_id === updatedPart.part_id
                        ? { ...line, ...updatedPart, quantity: line.quantity, cost_price: line.cost_price, sale_price: line.sale_price }
                        : line
                ));
                return 'Part updated successfully!';
            },
            error: 'Failed to update part.'
        });
    };

    const handleAppManagerClose = () => {
        setIsAppModalOpen(false);
        setCurrentPart(null);
    };

    const addPartToLines = (part) => {
        const existingLine = lines.find(line => line.part_id === part.part_id);
        if (existingLine) {
            setLines(lines.map(line =>
                line.part_id === part.part_id ? { ...line, quantity: line.quantity + 1 } : line
            ));
        } else {
            setLines([...lines, {
                ...part,
                part_id: part.part_id,
                quantity: 1,
                cost_price: typeof part.last_cost !== 'undefined' ? part.last_cost : 0,
                // Left null so the costing module derives a price from the landed cost at
                // the default markup. A price carried over from the catalogue would be
                // built on the last delivery's cost, not this one's.
                sale_price: null,
                effective_markup_percent: DEFAULT_MARKUP_PERCENT,
                line_discount_percent: null,
                line_discount_amount: null,
                override_freight_amount: null,
                return_quantity: 0,
                rejection_reason: null,
            }]);
        }
        setSearchTerm('');
    };

    const handleLineChange = (partId, field, value) => {
        const numericValue = Number.isFinite(value) ? value : 0;
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, [field]: numericValue } : line
        ));
    };

    // Non-numeric line fields (discount objects, rejection reasons) that handleLineChange's
    // Number coercion would destroy.
    const setLineFields = (partId, fields) => {
        setLines(prev => prev.map(line => (line.part_id === partId ? { ...line, ...fields } : line)));
    };

    // Price and markup are two views of the same decision, so editing either updates the
    // other. Typing a markup recomputes the price from the landed cost; typing a price
    // recomputes the markup it implies. Whichever the user touched last is the one kept.
    const handleMarkupChange = (partId, markup) => {
        const landed = costingByPart.get(partId)?.landed_unit_cost || 0;
        const nextMarkup = Number.isFinite(markup) ? markup : 0;
        setLineFields(partId, {
            effective_markup_percent: nextMarkup,
            sale_price: landed > 0 ? Math.round(landed * (1 + nextMarkup / 100) * 100) / 100 : null,
        });
    };

    const handleSalePriceChange = (partId, price) => {
        const landed = costingByPart.get(partId)?.landed_unit_cost || 0;
        const nextPrice = Number.isFinite(price) ? price : 0;
        const derived = markupFromPrice(nextPrice, landed);
        setLineFields(partId, {
            sale_price: nextPrice,
            ...(derived != null ? { effective_markup_percent: derived } : {}),
        });
    };

    const removeLine = (partId) => {
        setLines(lines.filter(line => line.part_id !== partId));
    };

    // Everything the API needs, in the shape both the one-shot post and the draft
    // endpoints accept.
    const buildPayload = () => ({
        supplier_id: selectedSupplier,
        received_by: user.employee_id,
        lines: lines.map(line => ({
            part_id: line.part_id,
            quantity: line.quantity,
            cost_price: line.cost_price,
            sale_price: costingByPart.get(line.part_id)?.sale_price ?? line.sale_price ?? null,
            line_discount_percent: line.line_discount_percent ?? null,
            line_discount_amount: line.line_discount_amount ?? null,
            override_freight_amount: line.override_freight_amount ?? null,
            effective_markup_percent: line.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT,
            return_quantity: line.return_quantity || 0,
            rejection_reason: line.rejection_reason || null,
        })),
        po_id: selectedPO ? selectedPO.po_id : null,
        receipt_date: receiptDate || null,
        is_backfill: isBackfill,
        supplier_invoice_no: isBackfill ? supplierInvoiceNo : (supplierInvoiceNo || null),
        freight_amount: freightAmount || 0,
        freight_allocation_method: freightMethod,
        freight_supplier_id: freightSupplierId || null,
        overall_discount_percent: overallDiscount.percent,
        overall_discount_amount: overallDiscount.amount,
        sync_retail_prices: syncRetailPrices,
    });

    const resetForm = () => {
        setLines([]);
        setSelectedSupplier('');
        setSelectedPO('');
        setReceiptDate('');
        setSupplierInvoiceNo('');
        setFreightAmount(0);
        setFreightSupplierId('');
        setFreightMethod(METHOD_A);
        setOverallDiscount({ percent: null, amount: null });
        setSyncRetailPrices(true);
        setStagedGrn(null);
    };

    // Shared validation for every way out of this screen.
    const validateBeforeSend = () => {
        if (!selectedSupplier || lines.length === 0) {
            toast.error('Please select a supplier and add at least one item.');
            return false;
        }
        if (isBackfill && !supplierInvoiceNo.trim()) {
            toast.error("Enter the supplier's invoice or DR number so this document can't be entered twice.");
            return false;
        }
        if (isBackfill && !receiptDate) {
            toast.error('Enter the date the goods actually arrived.');
            return false;
        }
        if (freightAmount > 0 && !freightSupplierId) {
            toast.error('Choose the carrier the freight is owed to.');
            return false;
        }
        if (costing.errors.length > 0) {
            toast.error(costing.errors[0].message);
            return false;
        }
        return true;
    };

    // Save this receipt as a staged document someone else can check. Nothing posts.
    const handleSaveAsDraft = async () => {
        if (!validateBeforeSend()) return;
        setSavingDraftRow(true);
        const payload = buildPayload();
        const request = stagedGrn
            ? api.put(`/goods-receipts/${stagedGrn.grn_id}/draft`, payload)
            : api.post('/goods-receipts/drafts', payload);

        try {
            const res = await toast.promise(request, {
                loading: stagedGrn ? 'Updating draft…' : 'Saving draft…',
                success: stagedGrn ? 'Draft updated.' : 'Draft saved for review.',
                error: (err) => err?.response?.data?.message || 'Could not save the draft.',
            });
            if (!stagedGrn) {
                setStagedGrn({ grn_id: res.data.grn_id, grn_number: res.data.grn_number, workflow_status: 'Draft' });
            } else if (res.data.returned_to_draft) {
                // Editing a submitted receipt sends it back for re-review, so the buttons
                // must stop offering to post it as though it were still approved.
                setStagedGrn(prev => ({ ...prev, workflow_status: 'Draft' }));
            }
            // The scratch buffer's job is done once the receipt is a real document.
            clearDraft();
            return res.data.grn_id;
        } catch {
            return null;
        } finally {
            setSavingDraftRow(false);
        }
    };

    const handleSubmitForReview = async () => {
        const grnId = stagedGrn?.grn_id || await handleSaveAsDraft();
        if (!grnId) return;
        try {
            await toast.promise(api.patch(`/goods-receipts/${grnId}/submit`), {
                loading: 'Submitting…',
                success: 'Sent for review.',
                error: (err) => err?.response?.data?.message || 'Could not submit this receipt.',
            });
            resetForm();
            onNavigate('goods_receipt_drafts');
        } catch { /* message already surfaced */ }
    };

    const handleReturnLine = async ({ return_quantity, rejection_reason, notes }) => {
        const line = returnTargetLine;
        if (!line) return;

        // Before a receipt exists on the server there is nothing to call — the rejection
        // is simply part of the document being typed.
        if (!stagedGrn) {
            setLineFields(line.part_id, {
                return_quantity: (Number(line.return_quantity) || 0) + Number(return_quantity),
                rejection_reason: rejection_reason === 'Other' ? `Other: ${notes}` : rejection_reason,
            });
            toast.success('Rejection recorded on this receipt.');
            return;
        }

        await toast.promise(
            api.post(`/goods-receipts/${stagedGrn.grn_id}/lines/${line.grn_line_id}/return`,
                { return_quantity, rejection_reason, notes }),
            {
                loading: 'Recording…',
                success: (res) => res.data.message,
                error: (err) => err?.response?.data?.message || 'Could not record the return.',
            },
        );
        setLineFields(line.part_id, {
            return_quantity: (Number(line.return_quantity) || 0) + Number(return_quantity),
            rejection_reason: rejection_reason === 'Other' ? `Other: ${notes}` : rejection_reason,
        });
    };

    const handlePostTransaction = async () => {
        if (!validateBeforeSend()) return;

        // A receipt already staged on the server posts through the workflow endpoint, so
        // its draft row moves to Posted rather than a second document being created.
        const payload = buildPayload();
        setPosting(true);
        const promise = stagedGrn
            ? api.post(`/goods-receipts/${stagedGrn.grn_id}/post`)
            : api.post('/goods-receipts', payload);

        toast.promise(promise, {
            loading: 'Posting transaction...',
            success: (res) => {
                const recon = res?.data?.reconciliations || [];
                const warnings = res?.data?.warnings || [];
                resetForm();
                fetchInitialData(); // Refresh PO list
                clearDraft();
                setPosting(false);
                // The quantity deliberately did not move for these lines. Say so here —
                // discovering it later on the stock report would look like a bug.
                if (recon.length > 0) {
                    toast(
                        `${recon.length} item${recon.length > 1 ? 's were' : ' was'} already counted after this receipt date, so the cost was applied but the quantity was not added again. Review under Stock Reconciliation.`,
                        { icon: 'ℹ️', duration: 8000 }
                    );
                }
                // The server accepts thin margins on this path for backwards
                // compatibility, but the person entering it should still hear about them.
                if (warnings.length > 0) {
                    toast(`${warnings.length} line${warnings.length > 1 ? 's are' : ' is'} priced below the ${MIN_MARKUP_PERCENT}% minimum markup.`,
                        { icon: '⚠️', duration: 7000 });
                }
                return 'Goods receipt created successfully!';
            },
            error: (err) => {
                setPosting(false);
                return err?.response?.data?.message || 'Failed to create goods receipt.';
            },
        });
    };

    if (loading) return <p className="text-gray-600 dark:text-slate-400">Loading data...</p>;

    const inputClass = "w-full h-9 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-500";
    const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";
    const selectClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed";

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100">
                        {stagedGrn ? `Reviewing ${stagedGrn.grn_number}` : 'New Goods Receipt'}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                        {stagedGrn
                            ? 'Check this against the supplier’s paperwork. Nothing has been posted yet.'
                            : 'Receive stock from a supplier, against a purchase order or directly.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onNavigate('goods_receipt_drafts')}
                        className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition text-sm font-medium flex items-center gap-1.5"
                    >
                        <Icon path={ICONS.receipt} className="h-4 w-4" /> Pending Review
                    </button>
                    <button
                        onClick={() => onNavigate('goods_receipt_history')}
                        className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition text-sm font-medium flex items-center gap-1.5"
                    >
                        <Icon path={ICONS.history} className="h-4 w-4" /> View History
                    </button>
                </div>
            </div>


            {expensePrefill && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-900/40 rounded-lg flex items-start gap-2">
                    <Icon path={ICONS.warning} className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div className="text-xs text-amber-900 dark:text-amber-200">
                        <p className="font-semibold">Carried over from an expense entry</p>
                        {expensePrefill.description && (
                            <p className="mt-0.5 italic text-amber-800 dark:text-amber-300">“{expensePrefill.description}”</p>
                        )}
                        <p className="mt-1 text-amber-800 dark:text-amber-300">
                            {expensePrefill.amount
                                ? `Amount mentioned: ${formatCurrency(expensePrefill.amount)} — add the parts received below and spread this across their unit costs.`
                                : 'Add the parts received below to record this as stock.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setExpensePrefill(null)}
                        aria-label="Dismiss"
                        className="ml-auto text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 shrink-0"
                    >
                        <Icon path={ICONS.close} className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 space-y-6 shadow-xs">
                {/* Draft saved indicator */}
                <div className="flex items-center justify-end text-xs text-gray-500 dark:text-slate-400">
                    {draftStatus === 'saving' && <span>Saving draft…</span>}
                    {draftStatus === 'saved' && (
                        <span>Draft saved{lastSavedAt ? ` at ${lastSavedAt.toLocaleTimeString()}` : ''}</span>
                    )}
                    {draftStatus === 'error' && <span className="text-danger-600 dark:text-danger-400">Draft save failed</span>}
                        {(draftStatus === 'saved' || draftStatus === 'saving' || draft) && (
                            <button
                                type="button"
                                onClick={async () => {
                                    await clearDraft();
                                    setSelectedSupplier('');
                                    setLines([]);
                                    setSelectedPO('');
                                    toast.success('Draft cleared');
                                }}
                                className="text-sm text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 ml-3"
                            >
                                Clear Draft
                            </button>
                        )}
                </div>
                <div className={`mb-4 rounded-xl border p-3 ${isBackfill
                    ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-gray-200 dark:border-slate-700'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isBackfill}
                            onChange={e => {
                                setIsBackfill(e.target.checked);
                                if (e.target.checked) setSelectedPO('');
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-slate-600"
                        />
                        <span>
                            <span className="block text-sm font-medium text-gray-900 dark:text-slate-100">
                                Backfill a past delivery
                            </span>
                            <span className="block text-xs text-gray-600 dark:text-slate-400 mt-0.5">
                                For deliveries that already arrived but were never recorded. Posts the stock and
                                cost at the real date, so the item&apos;s average cost is rebuilt correctly — but
                                creates no payable and does not touch any purchase order, since the goods were
                                paid for long ago.
                            </span>
                        </span>
                    </label>

                    {isBackfill && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className={labelClass}>Supplier Invoice / DR No.</label>
                                <input
                                    type="text"
                                    value={supplierInvoiceNo}
                                    onChange={e => setSupplierInvoiceNo(e.target.value)}
                                    placeholder="As printed on the document"
                                    className={selectClass}
                                />
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                    Required. Blocks the same document from being entered twice.
                                </p>
                            </div>
                            <div>
                                <label className={labelClass}>Date Received</label>
                                <input
                                    type="date"
                                    value={receiptDate}
                                    max={todayStr}
                                    onChange={e => setReceiptDate(e.target.value)}
                                    className={selectClass}
                                />
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                    Required. The date on the supplier&apos;s document.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={`${labelClass} flex items-center gap-1`}>
                            Receive Against Purchase Order (Optional)
                            <InfoTip label="Receive Against Purchase Order">
                                Only Purchase Orders with status Ordered appear in this list. Once a PO becomes
                                Partially Received, it drops off this list — plan to receive its full remaining
                                quantity in one pass where possible.
                            </InfoTip>
                        </label>
                        <select value={selectedPO ? selectedPO.po_id : ''} onChange={e => handleSelectPO(e.target.value)} className={selectClass} disabled={isBackfill}>
                            <option value="">{isBackfill ? '-- Not applicable when backfilling --' : '-- Select a PO --'}</option>
                            {openPOs.map(po => <option key={po.po_id} value={po.po_id}>{po.po_number} - {po.supplier_name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Supplier</label>
                        <div className="flex items-center space-x-2">
                            <div className="flex-grow">
                                <Combobox
                                    options={suppliers.map(s => ({ value: s.supplier_id, label: s.supplier_name }))}
                                    value={selectedSupplier}
                                    onChange={val => setSelectedSupplier(val)}
                                    placeholder="Select a Supplier"
                                    disabled={!!selectedPO}
                                />
                            </div>
                            <button onClick={() => setIsSupplierModalOpen(true)} className="px-3 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 text-sm disabled:opacity-60 disabled:cursor-not-allowed" disabled={!!selectedPO}>New</button>
                        </div>
                    </div>
                    {!isBackfill && (
                        <div>
                            <label className={`${labelClass} flex items-center gap-1`}>
                                Date Received (Optional)
                                <InfoTip label="Date Received">
                                    Leave blank if the goods arrived today. If you are entering older paperwork, set the
                                    date the goods actually arrived — otherwise the receipt is recorded after sales that
                                    already used the stock, which inflates the item&apos;s weighted average cost.
                                </InfoTip>
                            </label>
                            <input
                                type="date"
                                value={receiptDate}
                                max={todayStr}
                                onChange={e => setReceiptDate(e.target.value)}
                                className={selectClass}
                            />
                        </div>
                    )}
                </div>

                <div>
                    <label className={labelClass}>Add Part Manually</label>
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <SearchBar
                                ref={searchInputRef}
                                {...getInputProps()}
                                value={searchTerm}
                                onChange={setSearchTerm}
                                onClear={() => { setSearchTerm(''); reset(); }}
                                placeholder="Search by part name or SKU..."
                                disabled={!!selectedPO}
                            />
                            {searchResults.length > 0 && (
                                <ul id={resultsId} role="listbox" className="absolute z-10 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md mt-1 shadow-lg max-h-60 overflow-y-auto scrollbar-thin">
                                    {searchResults.map((part, idx) => {
                                        const itemProps = getItemProps(idx);
                                        return (
                                                <li
                                                    key={part.part_id}
                                                    {...itemProps}
                                                    className={`px-4 py-2 cursor-pointer ${itemProps['aria-selected'] ? 'bg-primary-100 dark:bg-primary-900/30' : 'hover:bg-primary-50 dark:hover:bg-slate-700/60'}`}
                                                >
                                                    <div className="flex items-baseline justify-between">
                                                        <div className="flex items-baseline space-x-2 flex-1 min-w-0">
                                                            <div className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">{part.display_name}</div>
                                                            {part.applications && <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{formatApplicationText(part.applications, { style: 'searchSuggestion' })}</div>}
                                                        </div>
                                                        <div className="flex items-baseline space-x-2 ml-2 shrink-0">
                                                            <span className={`text-xs font-medium ${Number(part.stock_on_hand) > 0 ? 'text-gray-500 dark:text-slate-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                                                {Number(part.stock_on_hand) || 0} in stock
                                                            </span>
                                                            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                                                                {formatCurrency(part.last_sale_price)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </li>
                                            );
                                    })}
                                </ul>
                            )}
                        </div>
                        <button onClick={() => setIsNewPartModalOpen(true)} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed" disabled={!!selectedPO}>
                           New Part
                        </button>
                    </div>
                </div>

                {/* Commercial terms for the shipment as a whole. Kept together and above the
                    lines because that is the order they appear on the supplier's paperwork. */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                    <div>
                        <label className={labelClass}>
                            Freight-in
                            <InfoTip label="Freight-in">
                                What it cost to get this delivery here. It is added to the cost of the goods
                                rather than booked as an expense, so unit cost — and every price built from
                                it — reflects what the stock actually cost you. The carrier is billed separately
                                from the parts supplier.
                            </InfoTip>
                        </label>
                        <button
                            type="button"
                            onClick={() => setIsFreightWizardOpen(true)}
                            disabled={lines.length === 0}
                            className="w-full h-10 px-3 flex items-center justify-between rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <span className={freightAmount > 0 ? 'font-mono text-gray-900 dark:text-slate-100' : 'text-gray-400 dark:text-slate-500'}>
                                {freightAmount > 0 ? formatCurrency(freightAmount) : 'No freight'}
                            </span>
                            <span className="text-xs text-primary-600 dark:text-primary-400">
                                {freightAmount > 0 ? 'Edit split' : 'Add'}
                            </span>
                        </button>
                        {freightAmount > 0 && !freightSupplierId && (
                            <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">Choose a carrier to bill.</p>
                        )}
                    </div>

                    <div>
                        <label className={labelClass}>
                            Discount on the whole receipt
                            <InfoTip label="Overall discount">
                                A reduction the supplier gave on the invoice total. It is spread across the
                                lines in proportion to their value, after freight, so each part carries its
                                fair share of it.
                            </InfoTip>
                        </label>
                        <DiscountInput
                            percent={overallDiscount.percent}
                            amount={overallDiscount.amount}
                            onChange={setOverallDiscount}
                            base={totals.gross_as_delivered - totals.line_discount_total}
                            aria-label="Overall discount"
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Catalogue prices</label>
                        <label className="flex items-start gap-2 h-10 px-3 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={syncRetailPrices}
                                onChange={(e) => setSyncRetailPrices(e.target.checked)}
                                className="mt-3"
                            />
                            <span className="self-center text-sm text-gray-700 dark:text-slate-300">
                                Update retail prices on post
                            </span>
                        </label>
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                            {syncRetailPrices
                                ? 'The sale prices below become the catalogue price for these parts.'
                                : 'Cost is updated; shelf prices are left exactly as they are.'}
                        </p>
                    </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
                            <tr>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide">Part Detail</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-28 text-center">Quantity</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-center">
                                    <span className="inline-flex items-center gap-1">
                                        Cost Price
                                        <InfoTip label="Cost Price">
                                            Editable here — this posts directly to inventory valuation and the
                                            supplier bill amount, not the PO's original cost. Always match the
                                            physical delivery and supplier invoice.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-36 text-center">
                                    <span className="inline-flex items-center gap-1">
                                        Discount
                                        <InfoTip label="Line discount">
                                            A reduction on this line only, as the supplier stated it — either a
                                            percentage or a flat amount, not both.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-28 text-right">
                                    <span className="inline-flex items-center gap-1">
                                        Freight
                                        <InfoTip label="Allocated freight">
                                            This line's share of the delivery charge. Set the split from the
                                            Freight-in box above; heavy items can take a flat amount instead of
                                            a share by value.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-right">
                                    <span className="inline-flex items-center gap-1">
                                        Landed Cost
                                        <InfoTip label="Landed unit cost">
                                            What one unit really cost: the supplier's price, less discounts, plus
                                            its share of the freight. This is the figure that posts to inventory
                                            and drives the weighted average cost.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-24 text-center">
                                    <span className="inline-flex items-center gap-1">
                                        Markup
                                        <InfoTip label="Markup">
                                            Defaults to {DEFAULT_MARKUP_PERCENT}%. Editing this recalculates the
                                            sale price, and editing the sale price recalculates this — they are
                                            two views of the same decision. Anything under {MIN_MARKUP_PERCENT}%
                                            is flagged.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-center">
                                    <span className="inline-flex items-center gap-1">
                                        Sale Price
                                        <InfoTip label="Sale Price">
                                            The price you intend to sell the part at going forward, built from the
                                            landed cost rather than the supplier's price.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-right">Line Total</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => {
                              const computed = costingByPart.get(line.part_id);
                              const belowMinMarkup = (computed?.landed_unit_cost || 0) > 0
                                  && (computed?.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT) < MIN_MARKUP_PERCENT;
                              const returned = Number(line.return_quantity) || 0;
                              return (
                                <tr key={line.part_id} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors">
                                    <td className="p-2 align-middle">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">{line.display_name}</div>
                                                {line.stock_on_hand !== undefined && line.stock_on_hand !== null && (
                                                    <div className={`text-xs font-medium ${Number(line.stock_on_hand) > 0 ? 'text-gray-500 dark:text-slate-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                                        {Number(line.stock_on_hand) || 0} in stock
                                                    </div>
                                                )}
                                                {returned > 0 && (
                                                    <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                                        {returned} returned{line.rejection_reason ? ` — ${line.rejection_reason}` : ''}
                                                        {' · keeping '}{computed?.accepted_quantity ?? 0}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => { setCurrentEditPart(line); setIsEditPartModalOpen(true); }}
                                                    className="inline-flex items-center justify-center h-8 w-8 text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30"
                                                    title="Edit Part"
                                                >
                                                    <Icon path={ICONS.edit} className="h-5 w-5"/>
                                                </button>
                                                <button
                                                    onClick={() => { setCurrentPart(line); setIsAppModalOpen(true); }}
                                                    className="inline-flex items-center justify-center h-8 w-8 text-success-600 dark:text-success-400 hover:text-success-800 dark:hover:text-success-300 rounded hover:bg-success-50 dark:hover:bg-success-900/30"
                                                    title="Manage Applications"
                                                >
                                                    <Icon path={ICONS.link} className="h-5 w-5"/>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={line.quantity}
                                            onChange={value => handleLineChange(line.part_id, 'quantity', value)}
                                            className={inputClass}
                                        />
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={line.cost_price}
                                            onChange={value => handleLineChange(line.part_id, 'cost_price', value)}
                                            className={inputClass}
                                        />
                                    </td>
                                    <td className="p-2 align-middle">
                                        <DiscountInput
                                            compact
                                            percent={line.line_discount_percent ?? null}
                                            amount={line.line_discount_amount ?? null}
                                            onChange={({ percent, amount }) => setLineFields(line.part_id, {
                                                line_discount_percent: percent,
                                                line_discount_amount: amount,
                                            })}
                                            base={(parseFloat(line.quantity) || 0) * (parseFloat(line.cost_price) || 0)}
                                            aria-label={`Discount for ${line.display_name || line.part_id}`}
                                        />
                                    </td>
                                    <td className="p-2 align-middle text-right font-mono text-sm text-gray-600 dark:text-slate-400">
                                        {formatCurrency(computed?.allocated_freight_amount || 0)}
                                        {line.override_freight_amount != null && (
                                            <span className="block text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">flat</span>
                                        )}
                                    </td>
                                    <td className="p-2 align-middle text-right font-mono text-sm font-semibold text-gray-900 dark:text-slate-100">
                                        {formatCurrency(computed?.landed_unit_cost || 0)}
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={line.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT}
                                            onChange={value => handleMarkupChange(line.part_id, value)}
                                            className={`${inputClass} ${belowMinMarkup ? 'border-danger-400 dark:border-danger-600' : ''}`}
                                            aria-label={`Markup for ${line.display_name || line.part_id}`}
                                        />
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={computed?.sale_price ?? line.sale_price ?? ''}
                                            onChange={value => handleSalePriceChange(line.part_id, value)}
                                            className={`${inputClass} ${belowMinMarkup ? 'border-danger-400 dark:border-danger-600' : ''}`}
                                        />
                                        {belowMinMarkup && (
                                            <span className="block mt-0.5 text-[10px] text-danger-600 dark:text-danger-400 text-center">
                                                under {MIN_MARKUP_PERCENT}%
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2 align-middle text-right font-mono text-sm font-medium text-gray-900 dark:text-slate-100">
                                        {formatCurrency(computed?.landed_line_total || 0)}
                                    </td>
                                    <td className="p-2 align-middle text-center">
                                        <div className="flex items-center justify-center">
                                            <button
                                                onClick={() => setReturnTargetLine(line)}
                                                className="inline-flex items-center justify-center h-8 w-8 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30"
                                                title="Reject or return some of this line"
                                            >
                                                <Icon path={ICONS.undo || ICONS.close} className="h-5 w-5"/>
                                            </button>
                                            <button
                                                onClick={() => removeLine(line.part_id)}
                                                className="inline-flex items-center justify-center h-8 w-8 text-danger-500 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 rounded hover:bg-danger-50 dark:hover:bg-danger-900/30"
                                                title="Remove"
                                            >
                                                <Icon path={ICONS.trash} className="h-5 w-5"/>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                              );
                            })}
                            {lines.length === 0 && (
                                <tr>
                                    <td colSpan="10" className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">
                                        No items added yet. Search for a part above, scan a barcode, or select a purchase order to begin.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-6 pt-4 border-t border-gray-200 dark:border-slate-700">
                    {/* Read top to bottom against the delivery receipt in your hand. The
                        supplier invoice total is the figure to check: it is computed from
                        what was DELIVERED, before anything was sent back, because that is
                        the number printed on their paper. What is actually owed, and what
                        actually reaches inventory, are shown separately below it. */}
                    <div className="w-full lg:max-w-md space-y-1 text-sm">
                        <div className="flex justify-between text-gray-500 dark:text-slate-400">
                            <span>{totals.lineCount} item{totals.lineCount === 1 ? '' : 's'} · {totals.totalQuantity.toLocaleString()} units</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-slate-400">Goods as delivered</span>
                            <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(totals.gross_as_delivered)}</span>
                        </div>
                        {totals.line_discount_total > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-slate-400">Less line discounts</span>
                                <span className="font-mono text-gray-900 dark:text-slate-100">−{formatCurrency(totals.line_discount_total)}</span>
                            </div>
                        )}
                        {totals.header_discount_total > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-slate-400">Less overall discount</span>
                                <span className="font-mono text-gray-900 dark:text-slate-100">−{formatCurrency(totals.header_discount_total)}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-baseline py-1.5 my-1 px-2 -mx-2 rounded bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
                            <span className="font-semibold text-primary-900 dark:text-primary-200 inline-flex items-center gap-1">
                                Supplier invoice total
                                <InfoTip label="Supplier invoice total">
                                    This should match the total printed on the supplier's invoice or delivery
                                    receipt. It counts everything as delivered, before anything you send back,
                                    so you can check your entry against the paper line by line.
                                </InfoTip>
                            </span>
                            <span className="font-mono font-bold text-lg text-primary-900 dark:text-primary-200">
                                {formatCurrency(totals.supplier_invoice_total)}
                            </span>
                        </div>
                        {totals.returned_value > 0 && (
                            <>
                                <div className="flex justify-between">
                                    <span className="text-amber-700 dark:text-amber-400">Less returned / rejected</span>
                                    <span className="font-mono text-amber-700 dark:text-amber-400">−{formatCurrency(totals.returned_value)}</span>
                                </div>
                                <div className="flex justify-between font-medium">
                                    <span className="text-gray-700 dark:text-slate-300">Payable to supplier</span>
                                    <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(totals.net_goods_value)}</span>
                                </div>
                            </>
                        )}
                        {totals.freight_amount > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-600 dark:text-slate-400">Plus freight (billed to carrier)</span>
                                <span className="font-mono text-gray-900 dark:text-slate-100">+{formatCurrency(totals.freight_amount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-slate-700 font-semibold">
                            <span className="text-gray-700 dark:text-slate-300">Value added to stock</span>
                            <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(totals.total_inventory_value)}</span>
                        </div>
                    </div>
                    {/* Three ways out: park it, hand it to someone to check, or commit it.
                        Posting is the only one that moves stock or money. */}
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                        <button
                            onClick={handleSaveAsDraft}
                            disabled={savingDraftRow || posting || !selectedSupplier || lines.length === 0}
                            className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {savingDraftRow ? 'Saving…' : stagedGrn ? 'Update draft' : 'Save as draft'}
                        </button>
                        {canSubmit && (
                            <button
                                onClick={handleSubmitForReview}
                                disabled={savingDraftRow || posting || !selectedSupplier || lines.length === 0}
                                className="px-4 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Submit for review
                            </button>
                        )}
                        <button
                            onClick={handlePostTransaction}
                            disabled={posting || !selectedSupplier || lines.length === 0 || (!!stagedGrn && !canPost)}
                            title={stagedGrn && !canPost ? 'Someone with posting rights has to approve this receipt.' : ''}
                            className="bg-success-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-success-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {posting ? (
                                <>
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                                    Posting...
                                </>
                            ) : (
                                'Post Transaction'
                            )}
                        </button>
                    </div>
                </div>

                {stagedGrn && (
                    <p className="text-xs text-gray-500 dark:text-slate-400 text-right">
                        Saved as <span className="font-mono">{stagedGrn.grn_number}</span> — nothing has been posted yet.
                        It will be given a permanent receipt number when it is.
                    </p>
                )}
            </div>
            <FreightAllocationWizard
                isOpen={isFreightWizardOpen}
                onClose={() => setIsFreightWizardOpen(false)}
                lines={lines}
                suppliers={suppliers}
                initialFreightAmount={freightAmount}
                initialFreightSupplierId={freightSupplierId}
                initialMethod={freightMethod}
                overallDiscountPercent={overallDiscount.percent}
                overallDiscountAmount={overallDiscount.amount}
                onApply={({ freight_amount, freight_supplier_id, freight_allocation_method, overrides }) => {
                    setFreightAmount(freight_amount);
                    setFreightSupplierId(freight_supplier_id || '');
                    setFreightMethod(freight_allocation_method);
                    setLines(prev => prev.map(l => ({
                        ...l,
                        override_freight_amount: overrides[l.part_id] ?? null,
                    })));
                }}
            />

            <ReturnLineModal
                isOpen={!!returnTargetLine}
                onClose={() => setReturnTargetLine(null)}
                line={returnTargetLine}
                isPosted={stagedGrn?.workflow_status === 'Posted'}
                onConfirm={handleReturnLine}
            />

            <GoodsReceiptModals
                // Modal states
                isSupplierModalOpen={isSupplierModalOpen}
                isNewPartModalOpen={isNewPartModalOpen}
                isEditPartModalOpen={isEditPartModalOpen}
                isAppModalOpen={isAppModalOpen}

                // Modal state setters
                setIsSupplierModalOpen={setIsSupplierModalOpen}
                setIsEditPartModalOpen={setIsEditPartModalOpen}
                setIsNewPartModalOpen={setIsNewPartModalOpen}
                setIsAppModalOpen={setIsAppModalOpen}
                setCurrentEditPart={setCurrentEditPart}
                setCurrentPart={setCurrentPart}

                // Data props
                brands={brands}
                groups={groups}
                currentPart={currentPart}
                currentEditPart={currentEditPart}

                // Handler functions
                handleNewSupplierSave={handleNewSupplierSave}
                handleSaveNewPart={handleSaveNewPart}
                handleEditPartSave={handleEditPartSave}
                handleAppManagerClose={handleAppManagerClose}
                fetchInitialData={fetchInitialData}

                // State updaters for lines
                _setLines={setLines}
                _lines={lines}
            />
        </div>
    );
};

export default GoodsReceiptPage;
