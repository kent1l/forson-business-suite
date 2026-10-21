import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useTypeahead from '../hooks/useTypeahead';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import Combobox from '../components/ui/Combobox';
import Modal from '../components/ui/Modal';
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
import ImportExtractedJsonDialog from '../components/goods-receipt/ImportExtractedJsonDialog';
import ImportReviewDrawer from '../components/goods-receipt/ImportReviewDrawer';
import PartForm from '../components/forms/PartForm';
import { formatCurrency } from '../utils/currency';
import { computeCosting, markupFromPrice, roundUpTo, DEFAULT_MARKUP_PERCENT, MIN_MARKUP_PERCENT, PRICE_ROUNDING_INCREMENT, METHOD_A } from '../utils/grnCosting';
import { useAuth } from '../contexts/AuthContext';
import usePartDuplicateResolution from '../hooks/usePartDuplicateResolution';
import useGrnImportReview from '../hooks/useGrnImportReview';
import { supplierReference, flattenReferenceMatches } from '../utils/supplierReference';
import { getNavContext, returnToOrigin, clearNavContext } from '../utils/apNavigationContract';
import { createUuid } from '../utils/createUuid';
import { receiptDateForInput, receiptDateForPayload } from '../utils/grnReceiptDate';

const upperCatalogText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();

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
    const [loadingEditPartId, setLoadingEditPartId] = useState(null);
    const [openPOs, setOpenPOs] = useState([]);
    const [selectedPO, setSelectedPO] = useState('');
    const [posting, setPosting] = useState(false);
    const [receiptDate, setReceiptDate] = useState('');
    const [isBackfill, setIsBackfill] = useState(false);
    const navCtx = useMemo(() => {
        return (pageState?.action ? pageState : (getNavContext() || {}));
    }, [pageState]);

    const [documentType, setDocumentType] = useState('other');
    const [relatedInvoiceNo, setRelatedInvoiceNo] = useState('');
    const [attachedBillId, setAttachedBillId] = useState(navCtx?.billId || null);
    const [attachedBillDetails, setAttachedBillDetails] = useState(null);
    const [candidateMatches, setCandidateMatches] = useState([]);
    const [matchesLoading, setMatchesLoading] = useState(false);
    const [matchesError, setMatchesError] = useState('');
    const [anotherDeliveryConfirmed, setAnotherDeliveryConfirmed] = useState(false);

    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [legacyReference, setLegacyReference] = useState(null);
    const [physicalReceiptConflict, setPhysicalReceiptConflict] = useState(null);
    const duplicateBlocksEntry = !!physicalReceiptConflict && !(anotherDeliveryConfirmed && attachedBillId
        && physicalReceiptConflict.receipts?.every(r => r.workflow_status === 'Posted' && Number(r.bill_id) === Number(attachedBillId)));
    const [referenceCheckError, setReferenceCheckError] = useState('');
    const [duplicateReview, setDuplicateReview] = useState(null);
    const [duplicateReviewLoading, setDuplicateReviewLoading] = useState(false);
    const supplierDocumentInputRef = useRef(null);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const { hasPermission } = useAuth();
    // Freight, discounts and the price-sync choice belong to the document as a whole,
    // not to any one line.
    const [freightAmount, setFreightAmount] = useState(0);
    const [freightSupplierId, setFreightSupplierId] = useState('');
    const [freightCosts, setFreightCosts] = useState([]);
    const [freightMethod, setFreightMethod] = useState(METHOD_A);
    const [overallDiscount, setOverallDiscount] = useState({ percent: null, amount: null });
    const [syncRetailPrices, setSyncRetailPrices] = useState(true);
    const [isFreightWizardOpen, setIsFreightWizardOpen] = useState(false);
    const [returnTargetLine, setReturnTargetLine] = useState(null);
    // Set once this receipt exists as a staged goods_receipt row rather than a local form.
    const [stagedGrn, setStagedGrn] = useState(null);
    const [savingDraftRow, setSavingDraftRow] = useState(false);
    const [catalogTarget, setCatalogTarget] = useState(null);

    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isImportReviewDrawerOpen, setIsImportReviewDrawerOpen] = useState(false);
    const [importPartTarget, setImportPartTarget] = useState(null);
    const [savingImportPart, setSavingImportPart] = useState(false);

    const canSubmit = hasPermission('goods_receipt:submit');
    const canPost = hasPermission('goods_receipt:post');
    const canEditSuppliers = hasPermission('suppliers:edit');
    const canCatalogParts = hasPermission('parts:create');

    // Set when a typed markup lands on a price that is not a whole PRICE_ROUNDING_INCREMENT,
    // and the receiver has to say which of the two they meant. Null the rest of the time.
    const [markupRounding, setMarkupRounding] = useState(null);

    // Reusable draft hook with slot isolation per context
    const slot = navCtx?.contextId || null;
    const draftData = useMemo(() => (stagedGrn ? {} : {
        selectedSupplier, lines, selectedPO, attachedBillId, documentType, relatedInvoiceNo, anotherDeliveryConfirmed, legacyReference,
        receiptDate, isBackfill,
        freightAmount, freightSupplierId, freightCosts, freightMethod, overallDiscount, syncRetailPrices, physicalReceiptNo,
    }), [stagedGrn, selectedSupplier, lines, selectedPO, attachedBillId, documentType, relatedInvoiceNo, anotherDeliveryConfirmed, legacyReference, receiptDate, isBackfill, freightAmount, freightSupplierId, freightCosts, freightMethod, overallDiscount, syncRetailPrices, physicalReceiptNo]);
    const isEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0) && !d?.selectedPO && !d?.attachedBillId && !d?.receiptDate && !d?.isBackfill), []);
    const { status: draftStatus, lastSavedAt, draft, loaded: draftLoaded, clearDraft } = useDraft('goods-receipt', { slot, data: draftData, isEmpty, debounceMs: 750 });

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

    const costingByRowKey = useMemo(() => {
        const map = new Map();
        lines.forEach((l, i) => {
            const key = l.line_uuid || l.client_row_key;
            if (key) map.set(key, costing.lines[i]);
        });
        return map;
    }, [lines, costing]);

    const costingByPart = useMemo(() => {
        const map = new Map();
        lines.forEach((l, i) => map.set(l.part_id, costing.lines[i]));
        return map;
    }, [lines, costing]);

    // For duplicate parts: identify the row supplying the catalog retail price.
    // Section 8: last eligible row in saved receipt order (greatest grn_line_id/index with sale_price != null and quantity > return_quantity).
    const catalogPriceSuppliers = useMemo(() => {
        const map = new Map();
        lines.forEach((l) => {
            if (!l.part_id) return;
            const netQty = (Number(l.quantity) || 0) - (Number(l.return_quantity) || 0);
            const key = l.line_uuid || l.client_row_key;
            const computedSale = stagedGrn?.import_provenance && l.sale_price == null ? null : costingByRowKey.get(key)?.sale_price ?? l.sale_price;
            if (computedSale != null && netQty > 0) {
                map.set(l.part_id, key);
            }
        });
        return new Set(map.values());
    }, [lines, costingByRowKey, stagedGrn]);

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

    const refreshLookupsOnly = useCallback(async () => {
        try {
            const [brandsRes, groupsRes] = await Promise.all([
                api.get('/brands'),
                api.get('/groups')
            ]);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
        } catch (err) {
            console.error('Failed to refresh lookups:', err);
        }
    }, []);

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
                supplier_invoice_no: header.supplier_invoice_no || header.physical_receipt_no || '',
                import_provenance: header.import_provenance || null,
            });
            setSelectedSupplier(String(header.supplier_id));
            setFreightAmount(Number(header.freight_amount) || 0);
            setFreightSupplierId(header.freight_supplier_id ? String(header.freight_supplier_id) : '');
            setFreightCosts(header.freight_costs || []);
            setFreightMethod(header.freight_allocation_method || METHOD_A);
            setOverallDiscount({
                percent: header.overall_discount_percent != null ? Number(header.overall_discount_percent) : null,
                amount: header.overall_discount_amount != null ? Number(header.overall_discount_amount) : null,
            });
            setSyncRetailPrices(header.sync_retail_prices !== false);
            setIsBackfill(!!header.is_backfill);
            setPhysicalReceiptNo(header.physical_receipt_no || header.supplier_invoice_no || '');
            setLegacyReference(!header.supplier_document_no ? {
                main: header.physical_receipt_no || header.supplier_invoice_no || '',
                physical_receipt_no: header.physical_receipt_no || null, supplier_invoice_no: header.supplier_invoice_no || null,
            } : null);
            if (header.bill_id) setAttachedBillId(header.bill_id);
            setDocumentType(header.supplier_document_type || 'other');
            setAnotherDeliveryConfirmed(header.another_delivery_confirmed === true);
            if (header.supplier_document_no) setPhysicalReceiptNo(header.supplier_document_no);
            setRelatedInvoiceNo('');
            if (header.supplier_invoice_no && header.supplier_invoice_no !== header.supplier_document_no && header.supplier_invoice_no !== header.physical_receipt_no) {
                setRelatedInvoiceNo(header.supplier_invoice_no);
            }
            setReceiptDate(receiptDateForInput(header.receipt_date));
            setLines((linesRes.data || []).map(l => ({
                ...l,
                line_uuid: l.line_uuid || null,
                client_row_key: l.line_uuid || createUuid(),
                part_number: l.part_number || null,
                part_numbers: l.part_numbers || null,
                quantity: Number(l.quantity),
                cost_price: Number(l.cost_price),
                sale_price: l.sale_price != null ? Number(l.sale_price) : null,
                line_discount_percent: l.line_discount_percent != null ? Number(l.line_discount_percent) : null,
                line_discount_amount: l.line_discount_amount != null ? Number(l.line_discount_amount) : null,
                override_freight_amount: l.override_freight_amount != null ? Number(l.override_freight_amount) : null,
                effective_markup_percent: l.effective_markup_percent != null ? Number(l.effective_markup_percent) : DEFAULT_MARKUP_PERCENT,
                return_quantity: Number(l.return_quantity) || 0,
                is_free_goods: l.is_free_goods === true,
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
        if (!draftLoaded || pageState?.grnId || navCtx?.grnId || stagedGrn) return;
        if (draft) {
            if (draft.receiptDate !== undefined) setReceiptDate(draft.receiptDate);
            if (draft.isBackfill !== undefined) setIsBackfill(draft.isBackfill);
            if (draft.selectedSupplier) setSelectedSupplier(draft.selectedSupplier);
            if (draft.lines) {
                setLines(draft.lines.map(l => ({
                    ...l,
                    client_row_key: l.client_row_key || l.line_uuid || createUuid(),
                })));
            }
            if (draft.selectedPO) setSelectedPO(draft.selectedPO);
            if (draft.freightAmount) setFreightAmount(draft.freightAmount);
            if (draft.freightSupplierId) setFreightSupplierId(draft.freightSupplierId);
            if (draft.freightCosts) setFreightCosts(draft.freightCosts);
            if (draft.freightMethod) setFreightMethod(draft.freightMethod);
            if (draft.overallDiscount) setOverallDiscount(draft.overallDiscount);
            if (draft.syncRetailPrices !== undefined) setSyncRetailPrices(draft.syncRetailPrices);
            if (draft.physicalReceiptNo !== undefined) setPhysicalReceiptNo(draft.physicalReceiptNo);
            if (draft.documentType) setDocumentType(draft.documentType);
            if (draft.relatedInvoiceNo) setRelatedInvoiceNo(draft.relatedInvoiceNo);
            if (draft.anotherDeliveryConfirmed) setAnotherDeliveryConfirmed(true);
            if (draft.legacyReference) setLegacyReference(draft.legacyReference);
            if (draft.attachedBillId) setAttachedBillId(draft.attachedBillId);
            toast('Loaded your saved draft.', { icon: '📄' });
        }
    }, [draftLoaded, draft, pageState?.grnId, navCtx?.grnId, stagedGrn]);

    useEffect(() => {
        if (navCtx?.supplierId && !selectedSupplier) {
            setSelectedSupplier(String(navCtx.supplierId));
        }
        if (navCtx?.billId && !attachedBillId) {
            setAttachedBillId(Number(navCtx.billId));
        }
        if (navCtx?.action === 'resume' && navCtx?.grnId) {
            loadStagedReceipt(navCtx.grnId);
        }
    }, [navCtx, selectedSupplier, attachedBillId, loadStagedReceipt]);

    useEffect(() => {
        let cancelled = false;
        setAttachedBillDetails(null);
        if (attachedBillId) {
            api.get(`/ap/supplier-bills/${attachedBillId}`)
                .then(res => { if (!cancelled) setAttachedBillDetails(res.data?.data || res.data || null); })
                .catch(() => { if (!cancelled) setAttachedBillDetails(null); });
        }
        return () => { cancelled = true; };
    }, [attachedBillId]);

    useEffect(() => {
        const docNo = physicalReceiptNo?.trim();
        if (!selectedSupplier || !docNo) {
            setCandidateMatches([]);
            setMatchesError('');
            setMatchesLoading(false);
            return undefined;
        }
        let cancelled = false;
        setMatchesLoading(true);
        setMatchesError('');
        setCandidateMatches([]);
        const timer = setTimeout(async () => {
            try {
                const { data } = await api.get('/ap/supplier-bills/matches', {
                    params: {
                        supplier_id: selectedSupplier,
                        document_type: documentType === 'other' ? undefined : documentType,
                        document_no: docNo,
                    },
                });
                if (!cancelled) {
                    setCandidateMatches(flattenReferenceMatches(data?.data));
                }
            } catch {
                if (!cancelled) { setCandidateMatches([]); setMatchesError('Could not check existing payables. Try again before creating a payable.'); }
            } finally {
                if (!cancelled) setMatchesLoading(false);
            }
        }, 400);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [selectedSupplier, documentType, physicalReceiptNo, relatedInvoiceNo]);

    useEffect(() => {
        const receiptNo = physicalReceiptNo;
        if (!selectedSupplier || !receiptNo.trim()) {
            setPhysicalReceiptConflict(null);
            setReferenceCheckError('');
            return undefined;
        }
        let cancelled = false;
        setPhysicalReceiptConflict(null);
        setReferenceCheckError('');
        const timer = setTimeout(async () => {
            try {
                const { data } = await api.get('/goods-receipts/check-supplier-reference', { params: {
                    supplier_id: selectedSupplier,
                    document_no: receiptNo,
                    document_type: documentType === 'other' ? undefined : documentType,
                    exclude_grn_id: stagedGrn?.grn_id,
                }});
                if (!cancelled) setPhysicalReceiptConflict(data.is_taken ? data : null);
            } catch {
                if (!cancelled) setReferenceCheckError('Could not check recorded receipts. Please try again.');
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [selectedSupplier, physicalReceiptNo, documentType, stagedGrn?.grn_id]);

    const openDuplicateReview = async (conflict = physicalReceiptConflict) => {
        if (!conflict?.grn_id) return;
        setDuplicateReview({ ...conflict, header: null, lines: [] });
        setDuplicateReviewLoading(true);
        try {
            const [headerRes, linesRes] = await Promise.all([
                api.get(`/goods-receipts/${conflict.grn_id}`),
                api.get(`/goods-receipts/${conflict.grn_id}/lines`),
            ]);
            setDuplicateReview(prev => prev && {
                ...prev,
                ...headerRes.data,
                header: headerRes.data,
                lines: linesRes.data || [],
            });
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Could not load the existing goods receipt details.');
        } finally {
            setDuplicateReviewLoading(false);
        }
    };

    const reviewDuplicateFromServer = async () => {
        const receiptNo = physicalReceiptNo;
        if (!selectedSupplier || !receiptNo.trim()) return;
        try {
            const { data } = await api.get('/goods-receipts/check-supplier-reference', { params: {
                supplier_id: selectedSupplier,
                document_no: receiptNo,
                    document_type: documentType === 'other' ? undefined : documentType,
                exclude_grn_id: stagedGrn?.grn_id,
            }});
            if (data.is_taken) {
                setPhysicalReceiptConflict(data);
                await openDuplicateReview(data);
            }
        } catch { /* the original backend conflict message remains visible */ }
    };

    const changeDuplicateDocumentNumber = () => {
        setDuplicateReview(null);
        requestAnimationFrame(() => supplierDocumentInputRef.current?.focus());
    };

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
            const linesWithSale = response.data.map(l => {
                const poCost = l.cost_price != null ? Number(l.cost_price) : (l.last_cost != null ? Number(l.last_cost) : 0);
                const poSale = l.sale_price != null && Number(l.sale_price) > 0
                    ? Number(l.sale_price)
                    : (l.last_sale_price != null && Number(l.last_sale_price) > 0 ? Number(l.last_sale_price) : null);
                return {
                    ...l,
                    client_row_key: createUuid(),
                    line_uuid: null,
                    cost_price: poCost,
                    sale_price: poSale,
                    display_name: l.display_name || l.custom_item_name,
                };
            });
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

    // Add a carrier without leaving a half-filled receipt. Carriers share the supplier
    // table with the parts suppliers — a carrier is simply another party the business
    // owes money to — so this goes through the same endpoint and the new record shows up
    // everywhere suppliers do. Takes whatever the caller has: the picker sends only a
    // name, the New button sends a full supplier form.
    const handleCreateCarrier = async (payload) => {
        const name = payload?.supplier_name?.trim();
        if (!name) {
            toast.error('The carrier needs a name.');
            return null;
        }
        try {
            const { data } = await toast.promise(
                api.post('/suppliers', { is_active: true, ...payload, supplier_name: name }),
                {
                    loading: 'Adding carrier…',
                    success: `${name} added.`,
                    error: (err) => err?.response?.data?.message || 'Could not add that carrier.',
                },
            );
            await fetchSuppliers();
            return data;
        } catch {
            return null;
        }
    };

    const { executePartSave, DuplicateDialog } = usePartDuplicateResolution();

    const handleSaveNewPart = async (partData) => {
        const result = await executePartSave({
            endpoint: '/parts',
            payload: { ...partData, created_by: user.employee_id },
            brands,
            groups,
        });

        if (result.outcome === 'cancelled' || result.outcome === 'error') {
            return;
        }

        setIsNewPartModalOpen(false);
        addPartToLines(result.part);
        toast.success(result.outcome === 'existing' ? 'Using existing catalog part.' : 'Part created successfully!');
    };

    const handleOpenEditPartModal = async (line) => {
        if (!line?.part_id) return;
        setLoadingEditPartId(line.part_id);
        try {
            const res = await api.get(`/parts/${line.part_id}`);
            setCurrentEditPart(res.data);
            setIsEditPartModalOpen(true);
        } catch (err) {
            console.error('Failed to load part details', err);
            toast.error(err?.response?.data?.message || 'Failed to load part details.');
        } finally {
            setLoadingEditPartId(null);
        }
    };

    const handleEditPartSave = (partData) => {
        if (!currentEditPart?.part_id) return;
        const payload = { ...partData, modified_by: user?.employee_id };
        const promise = api.put(`/parts/${currentEditPart.part_id}`, payload);

        toast.promise(promise, {
            loading: 'Updating part...',
            success: (response) => {
                const updatedPart = response.data;
                setIsEditPartModalOpen(false);
                setCurrentEditPart(null);
                // Update the line with the new part data
                setLines(prevLines => prevLines.map(line =>
                    line.part_id === updatedPart.part_id
                        ? {
                            ...line,
                            ...updatedPart,
                            quantity: line.quantity,
                            cost_price: line.cost_price,
                            sale_price: line.sale_price,
                            display_name: updatedPart.display_name || line.display_name,
                            detail: updatedPart.detail !== undefined ? updatedPart.detail : line.detail,
                            brand_name: updatedPart.brand_name || line.brand_name,
                            group_name: updatedPart.group_name || line.group_name,
                            part_numbers: updatedPart.part_numbers || line.part_numbers
                        }
                        : line
                ));
                return 'Part updated successfully!';
            },
            error: (err) => err?.response?.data?.message || 'Failed to update part.'
        });
    };

    const handleAppManagerClose = () => {
        setIsAppModalOpen(false);
        setCurrentPart(null);
    };

    const addPartToLines = (part) => {
        const matchingLines = lines.filter(line => line.part_id === part.part_id);
        if (matchingLines.length === 1) {
            const targetKey = matchingLines[0].line_uuid || matchingLines[0].client_row_key;
            setLines(lines.map(line =>
                (line.line_uuid || line.client_row_key) === targetKey
                    ? { ...line, quantity: line.quantity + 1 }
                    : line
            ));
        } else {
            const defaultCost = (part.last_receipt_unit_cost != null && Number(part.last_receipt_unit_cost) > 0)
                ? Number(part.last_receipt_unit_cost)
                : (part.last_cost != null ? Number(part.last_cost) : 0);

            const defaultSale = (part.last_sale_price != null && Number(part.last_sale_price) > 0)
                ? Number(part.last_sale_price)
                : (part.last_receipt_sale_price != null && Number(part.last_receipt_sale_price) > 0
                    ? Number(part.last_receipt_sale_price)
                    : null);

            const initialMarkup = (defaultSale != null && defaultCost > 0)
                ? (markupFromPrice(defaultSale, defaultCost) ?? DEFAULT_MARKUP_PERCENT)
                : DEFAULT_MARKUP_PERCENT;

            setLines([...lines, {
                ...part,
                client_row_key: createUuid(),
                line_uuid: null,
                part_id: part.part_id,
                quantity: 1,
                cost_price: defaultCost,
                sale_price: defaultSale,
                effective_markup_percent: initialMarkup,
                line_discount_percent: null,
                line_discount_amount: null,
                override_freight_amount: null,
                return_quantity: 0,
                rejection_reason: null,
                is_free_goods: false,
            }]);
        }
        setSearchTerm('');
    };

    const handleLineChange = (rowKey, field, value) => {
        const numericValue = Number.isFinite(value) ? value : 0;
        setLines(lines.map(line =>
            (line.line_uuid || line.client_row_key) === rowKey ? { ...line, [field]: numericValue } : line
        ));
    };

    // Non-numeric line fields (discount objects, rejection reasons) that handleLineChange's
    // Number coercion would destroy.
    const setLineFields = (rowKey, fields) => {
        setLines(prev => prev.map(line => ((line.line_uuid || line.client_row_key) === rowKey ? { ...line, ...fields } : line)));
    };

    // Price and markup are two views of the same decision, so editing either updates the
    // other. Typing a markup recomputes the price from the landed cost; typing a price
    // recomputes the markup it implies. Whichever the user touched last is the one kept,
    // and both columns always show the pair that actually holds — never a requested
    // markup sitting beside a price that no longer realises it.
    const applyMarkup = (rowKey, markup, price) => {
        setLineFields(rowKey, { effective_markup_percent: markup, sale_price: price });
    };

    const handleMarkupChange = (rowKey, markup) => {
        const landed = costingByRowKey.get(rowKey)?.landed_unit_cost || 0;
        const nextMarkup = Number.isFinite(markup) ? markup : 0;
        if (landed <= 0) {
            applyMarkup(rowKey, nextMarkup, null);
            return;
        }
        const exact = Math.round(landed * (1 + nextMarkup / 100) * 100) / 100;
        const rounded = roundUpTo(exact);
        if (rounded === exact) {
            applyMarkup(rowKey, nextMarkup, exact);
            return;
        }
        // A markup someone typed deliberately is a different thing from one the system
        // assumed, so this is the one place the rounding is put to them rather than
        // applied silently. Rounding up stays the default; keeping the exact percentage
        // is there for the lines where the margin is the number that was negotiated.
        const line = lines.find(l => (l.line_uuid || l.client_row_key) === rowKey);
        setMarkupRounding({
            rowKey,
            name: line?.display_name || line?.part_number || line?.part_numbers || line?.internal_sku || `Line ${line?.part_id || ''}`,
            markup: nextMarkup,
            landed,
            exact,
            rounded,
        });
    };

    const resolveMarkupRounding = (useRounded) => {
        if (!markupRounding) return;
        const { rowKey, markup, landed, exact, rounded } = markupRounding;
        if (useRounded) {
            applyMarkup(rowKey, markupFromPrice(rounded, landed) ?? markup, rounded);
        } else {
            applyMarkup(rowKey, markup, exact);
        }
        setMarkupRounding(null);
    };

    const handleSalePriceChange = (rowKey, price) => {
        if (stagedGrn?.import_provenance && price == null) {
            setLineFields(rowKey, { sale_price: null });
            return;
        }
        const landed = costingByRowKey.get(rowKey)?.landed_unit_cost || 0;
        const nextPrice = Number.isFinite(price) ? price : 0;
        const derived = markupFromPrice(nextPrice, landed);
        setLineFields(rowKey, {
            sale_price: nextPrice,
            ...(derived != null ? { effective_markup_percent: derived } : {}),
        });
    };

    const removeLine = (rowKey) => {
        setLines(lines.filter(line => (line.line_uuid || line.client_row_key) !== rowKey));
    };

    const removeUncatalogedLine = (poLineId) => {
        setLines(current => current.filter(line => line.po_line_id !== poLineId));
    };

    const catalogPrefill = useMemo(() => {
        if (!catalogTarget) return null;
        const draft = catalogTarget.draft_part_data || {};
        const brand = brands.find(item => Number(item.brand_id) === Number(draft.brand_id))
            || brands.find(item => upperCatalogText(item.brand_name) === upperCatalogText(draft.brand));
        const group = groups.find(item => Number(item.group_id) === Number(draft.group_id))
            || groups.find(item => upperCatalogText(item.group_name) === upperCatalogText(draft.group));
        const packSize = upperCatalogText(draft.pack_size);
        const parsedDetail = upperCatalogText(draft.detail || catalogTarget.custom_item_name);
        const detail = packSize && !parsedDetail.includes(packSize)
            ? `${parsedDetail} ${packSize}`.trim()
            : parsedDetail;
        return {
            po_line_id: catalogTarget.po_line_id,
            detail,
            brand_id: brand?.brand_id || '',
            brand_name: upperCatalogText(draft.brand),
            group_id: group?.group_id || '',
            group_name: upperCatalogText(draft.group),
            measurement_unit: upperCatalogText(draft.purchase_uom || catalogTarget.unit || 'PCS'),
            last_cost: catalogTarget.cost_price || 0,
        };
    }, [catalogTarget?.po_line_id]);

    const handleCatalogPart = async (partData) => {
        if (!catalogTarget || !selectedPO) return;
        const result = await executePartSave({
            endpoint: `/purchase-orders/${selectedPO.po_id}/lines/${catalogTarget.po_line_id}/catalog`,
            payload: partData,
            brands,
            groups,
        });

        if (result.outcome === 'cancelled' || result.outcome === 'error') {
            return;
        }

        const fullPart = result.part;
        setLines(current => current.map(line => line.po_line_id === catalogTarget.po_line_id ? {
            ...line,
            ...fullPart,
            part_id: fullPart.part_id,
            draft_part_data: null,
            display_name: fullPart.display_name || fullPart.detail,
            quantity: line.quantity,
            cost_price: line.cost_price,
        } : line));
        setCatalogTarget(null);
        toast.success(result.outcome === 'existing'
            ? 'Matching catalog part found and linked to this PO line.'
            : 'Part cataloged and ready to receive.');
    };

    // Everything the API needs, in the shape both the one-shot post and the draft
    // endpoints accept.
    const buildPayload = () => ({
        line_identity_version: 1,
        supplier_id: selectedSupplier,
        received_by: user.employee_id,
        bill_id: attachedBillId || null,
        lines: lines.map((line, idx) => {
            const rowKey = line.line_uuid || line.client_row_key;
            const rowCosting = costingByRowKey.get(rowKey) || costing.lines[idx];
            return {
                line_uuid: line.line_uuid || undefined,
                client_row_key: line.client_row_key || undefined,
                part_id: line.part_id,
                quantity: line.quantity,
                cost_price: line.cost_price,
                sale_price: stagedGrn?.import_provenance && line.sale_price == null ? null : rowCosting?.sale_price ?? line.sale_price ?? null,
                line_discount_percent: line.line_discount_percent ?? null,
                line_discount_amount: line.line_discount_amount ?? null,
                override_freight_amount: line.override_freight_amount ?? null,
                effective_markup_percent: line.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT,
                return_quantity: line.return_quantity || 0,
                rejection_reason: line.rejection_reason || null,
                is_free_goods: line.is_free_goods === true,
            };
        }),
        po_id: selectedPO ? selectedPO.po_id : null,
        receipt_date: receiptDateForPayload(receiptDate),
        is_backfill: isBackfill,
        supplier_document_type: documentType,
        supplier_document_no: physicalReceiptNo ? physicalReceiptNo.trim() : null,
        supplier_invoice_no: (documentType === 'invoice' ? physicalReceiptNo?.trim() : relatedInvoiceNo?.trim()) || null,
        another_delivery_confirmed: anotherDeliveryConfirmed,
        physical_receipt_no: documentType === 'delivery_receipt' ? physicalReceiptNo.trim() || null : null,
        ...(legacyReference && legacyReference.main === physicalReceiptNo ? {
            supplier_document_no: undefined, supplier_document_type: undefined,
            physical_receipt_no: legacyReference.physical_receipt_no, supplier_invoice_no: legacyReference.supplier_invoice_no,
        } : {}),
        freight_amount: freightAmount || 0,
        freight_allocation_method: freightMethod,
        freight_supplier_id: freightSupplierId || null,
        freight_costs: freightCosts.filter(c => Number(c.amount) > 0).map(c => ({
            supplier_id: c.supplier_id ? Number(c.supplier_id) : null,
            amount: Number(c.amount) || 0,
            receipt_number: c.receipt_number?.trim() || null,
            notes: c.notes?.trim() || null,
            is_paid: Boolean(c.is_paid),
            payment_method_id: c.is_paid && c.payment_method_id ? Number(c.payment_method_id) : null,
        })),
        overall_discount_percent: overallDiscount.percent,
        overall_discount_amount: overallDiscount.amount,
        sync_retail_prices: syncRetailPrices,
    });

    const resetForm = () => {
        setLines([]);
        setSelectedSupplier('');
        setSelectedPO('');
        setReceiptDate('');
        setPhysicalReceiptNo('');
        setLegacyReference(null);
        setPhysicalReceiptConflict(null);
        setDocumentType('other');
        setRelatedInvoiceNo('');
        setAttachedBillId(null);
        setCandidateMatches([]);
        setAnotherDeliveryConfirmed(false);
        setFreightAmount(0);
        setFreightSupplierId('');
        setFreightCosts([]);
        setFreightMethod(METHOD_A);
        setOverallDiscount({ percent: null, amount: null });
        setSyncRetailPrices(true);
        setStagedGrn(null);
    };

    // Shared validation for every way out of this screen.
    const validateBeforeSend = () => {
        if (duplicateBlocksEntry) {
            void openDuplicateReview(physicalReceiptConflict);
            return false;
        }
        if (referenceCheckError || (!attachedBillId && matchesError)) { toast.error('Check the supplier reference before continuing.'); return false; }
        if (!attachedBillId && candidateMatches.some(m => m.match_reason !== 'different_document_type')) { toast.error('Select the existing payable before continuing.'); return false; }
        if (!selectedSupplier || lines.length === 0) {
            toast.error('Please select a supplier and add at least one item.');
            return false;
        }
        if (lines.some(line => !line.part_id)) {
            toast.error('Catalog or remove every uncataloged PO line before saving this receipt.');
            return false;
        }
        if (isBackfill && !physicalReceiptNo.trim()) {
            toast.error('Enter the supplier document number so this document cannot be entered twice.');
            return false;
        }
        if (isBackfill && !receiptDate) {
            toast.error('Enter the date the goods actually arrived.');
            return false;
        }
        if (freightCosts.length > 0) {
            for (let i = 0; i < freightCosts.length; i++) {
                const c = freightCosts[i];
                if (Number(c.amount) > 0 && !c.is_paid && !c.supplier_id) {
                    toast.error(`Freight charge #${i + 1} is marked unpaid — choose the carrier it is owed to.`);
                    return false;
                }
            }
        } else if (freightAmount > 0 && !freightSupplierId) {
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
            if (res.data.identity_mappings?.length) {
                const map = new Map(res.data.identity_mappings.map(m => [m.client_row_key, m.line_uuid]));
                setLines(prev => prev.map(l => {
                    if (l.client_row_key && map.has(l.client_row_key)) {
                        return { ...l, line_uuid: map.get(l.client_row_key) };
                    }
                    return l;
                }));
            }
            // The scratch buffer's job is done once the receipt is a real document.
            clearDraft();
            return res.data.grn_id;
        } catch (err) {
            if (err?.response?.status === 409) void reviewDuplicateFromServer();
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

        const rowKey = line.line_uuid || line.client_row_key;

        // Before a receipt exists on the server there is nothing to call — the rejection
        // is simply part of the document being typed.
        if (!stagedGrn) {
            setLineFields(rowKey, {
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
        setLineFields(rowKey, {
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
                clearNavContext();
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
                if (err?.response?.status === 409) void reviewDuplicateFromServer();
                return err?.response?.data?.message || 'Failed to create goods receipt.';
            },
        });
    };

    const importReview = useGrnImportReview({
        autoMatchEnabled: isImportReviewDrawerOpen && !importPartTarget && hasPermission('goods_receipt:create'),
        onCommitted: async (commitResult) => {
            toast.success(`Import committed as GRN ${commitResult.grn_number}!`);
            setIsImportReviewDrawerOpen(false);
            if (commitResult.grn_id) {
                await loadStagedReceipt(commitResult.grn_id);
            }
        },
        onError: (err) => {
            toast.error(err?.response?.data?.message || err?.message || 'Import error');
        },
    });

    const handleCreateImportPart = (rowId) => {
        if (!canCatalogParts || importReview.review?.status !== 'IN_REVIEW') return;
        const row = importReview.review.review_state.rows.find(item => item.row_id === rowId);
        if (!row?.included) return;
        const source = importReview.review.source_payload?.lines?.find(item => item.line_no === row.line_no) || {};
        const brandName = upperCatalogText(source.brand);
        const groupName = upperCatalogText(source.item_group_hint);
        setImportPartTarget({
            import_id: importReview.review.import_id,
            row_id: rowId,
            line_no: row.line_no,
            initialValues: {
                detail: upperCatalogText(source.supplier_item_text || source.description),
                part_numbers: upperCatalogText(source.part_number),
                brand_id: brands.find(item => upperCatalogText(item.brand_name) === brandName)?.brand_id || '',
                brand_name: brandName,
                group_id: groups.find(item => upperCatalogText(item.group_name) === groupName)?.group_id || '',
                group_name: groupName,
                measurement_unit: upperCatalogText(source.unit || 'PCS'),
                last_cost: row.confirmed_row?.cost_price ?? source.unit_cost ?? 0,
                last_sale_price: row.confirmed_row?.sale_price ?? 0,
            },
        });
    };

    const handleSaveImportPart = async (partData) => {
        if (!canCatalogParts || !importPartTarget || savingImportPart) return;
        setSavingImportPart(true);
        try {
            const result = await executePartSave({
                endpoint: '/parts',
                payload: { ...partData, created_by: user.employee_id },
                brands,
                groups,
            });
            if (result.outcome === 'cancelled' || result.outcome === 'error') return;

            importReview.queueAction({
                type: 'set_row',
                row_id: importPartTarget.row_id,
                values: {
                    part_id: result.part.part_id,
                    stock_uom: result.part.measurement_unit,
                },
            }, result.part);
            setImportPartTarget(null);
            toast.success(result.outcome === 'existing'
                ? 'Existing catalog part linked to this import line.'
                : 'Part created and linked to this import line.');
        } finally {
            setSavingImportPart(false);
        }
    };

    const closeImportPartForm = () => {
        if (!savingImportPart) setImportPartTarget(null);
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const importIdParam = params.get('import_id') || pageState?.import_id;
        if (importIdParam && hasPermission('goods_receipt:create')) {
            importReview.fetchReview(importIdParam)
                .then(() => setIsImportReviewDrawerOpen(true))
                .catch(() => {});
        }
    }, [pageState]);

    const handleOpenImportReview = async ({ payload, requestKey, importId }) => {
        if (importId) {
            await importReview.fetchReview(importId);
        } else {
            await importReview.createImport({
                requestKey,
                payload,
                context: {
                    supplier_id: selectedSupplier ? Number(selectedSupplier) : undefined,
                    bill_id: attachedBillId ? Number(attachedBillId) : undefined,
                },
            });
        }
        setIsImportReviewDrawerOpen(true);
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
                    {stagedGrn && (physicalReceiptNo || stagedGrn.supplier_invoice_no) && (
                        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-md bg-gray-100 dark:bg-slate-700/60 border border-gray-200 dark:border-slate-600 text-sm">
                            <span className="text-gray-500 dark:text-slate-400 font-medium">Supplier document:</span>
                            <span className="font-mono font-semibold text-gray-900 dark:text-slate-100">
                                {physicalReceiptNo || stagedGrn.supplier_invoice_no}
                            </span>
                        </div>
                    )}
                    {stagedGrn?.import_provenance && (
                        <div className="mt-2 ml-2 inline-flex items-center gap-2 px-3 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-sm">
                            <span className="text-indigo-600 dark:text-indigo-400 font-medium">Source:</span>
                            <span className="font-mono text-xs text-indigo-900 dark:text-indigo-200">
                                Imported JSON ({stagedGrn.import_provenance.import_id?.slice(0, 8)})
                            </span>
                            <button
                                type="button"
                                onClick={async () => {
                                    await importReview.fetchReview(stagedGrn.import_provenance.import_id);
                                    setIsImportReviewDrawerOpen(true);
                                }}
                                className="text-xs text-indigo-700 dark:text-indigo-300 underline font-semibold hover:text-indigo-900 ml-1"
                            >
                                View source review
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {importReview.capabilities?.enabled && hasPermission('goods_receipt:create') && (
                        <button
                            type="button"
                            onClick={() => {
                                if (stagedGrn) {
                                    if (window.confirm('You are currently viewing a saved receipt. Starting a new import will begin a new receipt. Continue?')) {
                                        resetForm();
                                        setIsImportModalOpen(true);
                                    }
                                } else {
                                    setIsImportModalOpen(true);
                                }
                            }}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium flex items-center gap-1.5 shadow-xs"
                        >
                            <Icon path={ICONS.download || ICONS.document} className="h-4 w-4" /> Import extracted JSON
                        </button>
                    )}
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

            {navCtx?.source && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between gap-3">
                    <div className="text-sm text-blue-900 dark:text-blue-100 flex items-center gap-2">
                        <Icon path={ICONS.info} className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>
                            Receiving goods for{' '}
                            <strong>
                                {suppliers.find(s => String(s.supplier_id) === String(selectedSupplier))?.supplier_name || 'selected supplier'}
                            </strong>
                            {attachedBillDetails && (
                                <span className="ml-2 font-mono text-xs bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.5 rounded text-blue-800 dark:text-blue-200">
                                    Payable: {supplierReference(attachedBillDetails)} ({formatCurrency(attachedBillDetails.total_amount)})
                                </span>
                            )}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => returnToOrigin(onNavigate, navCtx)}
                        className="text-xs font-semibold px-3 py-1.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 rounded-md text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 transition"
                    >
                        ← Return to {navCtx.source?.pageKey === 'suppliers' ? 'Suppliers' : 'Accounts Payable'}
                    </button>
                </div>
            )}

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
                                    onChange={val => { setSelectedSupplier(val); setAttachedBillId(null); setAnotherDeliveryConfirmed(false); }}
                                    placeholder="Select a Supplier"
                                    disabled={!!selectedPO}
                                />
                            </div>
                            <button onClick={() => setIsSupplierModalOpen(true)} className="px-3 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 text-sm disabled:opacity-60 disabled:cursor-not-allowed" disabled={!!selectedPO}>New</button>
                        </div>
                    </div>
                    <div>
                            <label className={`${labelClass} flex items-center gap-1`}>
                                Date Received {isBackfill ? '' : '(Optional)'}
                                <InfoTip label="Date Received">
                                    {isBackfill ? 'Required. Use the date on the supplier document.' : 'Leave blank if the goods arrived today. If you are entering older paperwork, set the'}
                                    {!isBackfill && <>
                                    date the goods actually arrived — otherwise the receipt is recorded after sales that
                                    already used the stock, which inflates the item&apos;s weighted average cost.
                                    </>}
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
                    <div className="space-y-3">
                        <div>
                            <label className={labelClass} htmlFor="supplier-document-number">Supplier Document No. {isBackfill ? '' : '(optional)'}</label>
                            <input id="supplier-document-number" type="text" ref={supplierDocumentInputRef}
                                value={physicalReceiptNo} maxLength={255}
                                onChange={e => { setPhysicalReceiptNo(e.target.value); setAnotherDeliveryConfirmed(false); }}
                                placeholder="Enter the number printed on the supplier paperwork"
                                className={selectClass} />
                            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Use your AR, DR, SI, packing list or waybill number. We check this supplier’s existing records.</p>
                        </div>
                        <details className="text-sm">
                            <summary className="cursor-pointer text-gray-600 dark:text-slate-400">Document details (optional)</summary>
                            <label className={labelClass + ' mt-2'}>Document type (if known)</label>
                            <select value={documentType} onChange={e => { setDocumentType(e.target.value); setAnotherDeliveryConfirmed(false); }} className={selectClass}>
                                <option value="other">Unspecified / Other</option>
                                <option value="delivery_receipt">Delivery Receipt (DR)</option>
                                <option value="invoice">Sales / Tax Invoice (SI)</option>
                                <option value="acknowledgement">Acknowledgement Receipt (AR)</option>
                                <option value="packing_list">Packing List</option>
                                <option value="waybill">Waybill</option>
                            </select>
                            {documentType !== 'invoice' && (
                                <div className="mt-2">
                                    <label className={labelClass}>Related invoice number (if supplied)</label>
                                    <input value={relatedInvoiceNo} onChange={e => setRelatedInvoiceNo(e.target.value)} className={selectClass} />
                                </div>
                            )}
                        </details>

                        {attachedBillDetails && (
                            <div className="flex items-center justify-between p-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs">
                                <span className="text-emerald-800 dark:text-emerald-200 font-medium">
                                    Payable: {supplierReference(attachedBillDetails)} ({formatCurrency(attachedBillDetails.total_amount)})
                                </span>
                                <button
                                    type="button"
                                    disabled={!!navCtx?.billId} onClick={() => { setAttachedBillId(null); setAnotherDeliveryConfirmed(false); }}
                                    className="text-danger-600 dark:text-danger-400 font-semibold hover:underline ml-2"
                                >
                                    Unlink
                                </button>
                            </div>
                        )}

                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            {isBackfill ? 'Required for a backfill. ' : ''}Use the supplier document reference to verify against payables and prevent duplicates.
                        </p>

                        {attachedBillId ? (
                            <p className="text-xs text-primary-700 dark:text-primary-300">Receiving against the selected payable; no new goods payable will be created.</p>
                        ) : !isBackfill && (
                            <p className="text-xs text-gray-600 dark:text-slate-400">Posting creates a new goods payable from these items. Select an existing match above if it is already recorded.</p>
                        )}
                        {anotherDeliveryConfirmed && <p role="status" className="text-xs text-warning-700 dark:text-warning-300">Another physical arrival confirmed for the selected payable.</p>}
                        {physicalReceiptConflict && (
                            <div className="mt-2 rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/30 p-3" role="status" aria-live="polite">
                                <p className="text-xs font-semibold text-danger-700 dark:text-danger-300">
                                    Already used by {physicalReceiptConflict.grn_number} ({physicalReceiptConflict.workflow_status}).
                                </p>
                                <button
                                    type="button"
                                    onClick={() => openDuplicateReview(physicalReceiptConflict)}
                                    className="mt-2 text-xs font-semibold text-danger-700 dark:text-danger-300 underline underline-offset-2 hover:text-danger-900 dark:hover:text-danger-100"
                                >
                                    Review existing GRN
                                </button>
                            </div>
                        )}

                        {referenceCheckError && <p role="alert" className="text-xs text-danger-600">{referenceCheckError}</p>}
                        {matchesError && <p role="alert" className="text-xs text-danger-600">{matchesError}</p>}
                        {matchesLoading && (
                            <p className="text-xs text-gray-500">Checking for matching supplier bills…</p>
                        )}

                        {candidateMatches.length > 0 && (
                            <div className="mt-2 space-y-2">
                                {candidateMatches.map((match) => (
                                    <div key={match.bill_id} className="p-3 bg-primary-50/70 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-800 rounded-lg">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold uppercase text-primary-700 dark:text-primary-300">
                                                        Matching Supplier Bill
                                                    </span>
                                                    <span className="text-xs font-mono font-medium text-gray-900 dark:text-slate-100">
                                                        {supplierReference(match)}
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        ({match.status})
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">
                                                    Total: <span className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(match.total_amount)}</span> · Reference: {match.matched_doc_no || supplierReference(match)}{match.match_reason === 'different_document_type' ? ' (different document type; review)' : ''}
                                                </p>
                                            </div>
                                            <div>
                                                {attachedBillId === match.bill_id ? (
                                                    <span className="text-xs font-semibold px-2 py-1 rounded bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300">
                                                        ✓ Using this bill
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={!!navCtx?.billId && Number(navCtx.billId) !== Number(match.bill_id)}
                                                        onClick={() => { setAttachedBillId(match.bill_id); setAnotherDeliveryConfirmed(false); }}
                                                        className="px-2.5 py-1 text-xs font-semibold rounded bg-primary-600 text-white hover:bg-primary-700 transition"
                                                    >
                                                        Use this bill
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {match.existing_receipts?.length > 0 && (
                                            <div className="mt-2 pt-2 border-t border-primary-100 dark:border-primary-900/40 text-xs">
                                                <p className="text-gray-600 dark:text-slate-400 font-medium mb-1">
                                                    Prior deliveries recorded against this bill ({match.existing_receipts.length}):
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {match.existing_receipts.map(r => (
                                                        <button type="button" key={r.grn_id} onClick={() => r.workflow_status === 'Posted' ? openDuplicateReview(r) : loadStagedReceipt(r.grn_id)} className="font-mono bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-2 py-0.5 rounded text-gray-700 dark:text-slate-300">
                                                            {supplierReference(r)} · {r.grn_number} ({r.workflow_status || r.status})
                                                        </button>
                                                    ))}
                                                </div>
                                                {!anotherDeliveryConfirmed && match.existing_receipts.every(r => r.workflow_status === 'Posted') && (
                                                    <div className="mt-2 flex items-center justify-between bg-amber-50 dark:bg-amber-950/40 p-2 rounded border border-amber-200 dark:border-amber-800">
                                                        <span className="text-amber-800 dark:text-amber-200">
                                                            This payable already has deliveries recorded. Review them before recording another arrival.
                                                        </span>
                                                        <button
                                                            type="button"
                                                            disabled={!!navCtx?.billId && Number(navCtx.billId) !== Number(match.bill_id)}
                                                            onClick={() => { setAttachedBillId(match.bill_id); setAnotherDeliveryConfirmed(true); }}
                                                            className="text-xs font-semibold px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700"
                                                        >
                                                            Record another delivery
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
                                {freightAmount > 0
                                    ? `${formatCurrency(freightAmount)}${freightCosts.length > 1 ? ` (${freightCosts.length} charges)` : ''}`
                                    : 'No freight'}
                            </span>
                            <span className="text-xs text-primary-600 dark:text-primary-400">
                                {freightAmount > 0 ? 'Edit split' : 'Add'}
                            </span>
                        </button>
                        {(freightCosts.length > 0
                            ? freightCosts.some(c => Number(c.amount) > 0 && !c.is_paid && !c.supplier_id)
                            : freightAmount > 0 && !freightSupplierId) && (
                            <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">Choose a carrier for unpaid freight.</p>
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
                            {lines.map((line, index) => {
                              const rowKey = line.line_uuid || line.client_row_key || `row_${index}`;
                              const computed = costing.lines[index] || costingByRowKey.get(rowKey) || costingByPart.get(line.part_id);
                              const belowMinMarkup = (computed?.landed_unit_cost || 0) > 0
                                  && (computed?.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT) < MIN_MARKUP_PERCENT;
                              const returned = Number(line.return_quantity) || 0;
                              const isFree = line.is_free_goods === true;
                              // The giveaway claim only makes sense against a zero cost, so the
                              // checkbox stays out of the way until the line actually has no
                              // price on it (and stays visible on a free line so it can be
                              // un-marked). A cost still being typed as an expression is not
                              // zero, so it hides the box too.
                              const costIsZero = (Number(line.cost_price) || 0) === 0;
                              // A cost of zero that nobody has claimed as a giveaway. The line
                              // still delivers stock; it just will not move the average cost.
                              const isUncosted = computed?.is_uncosted === true;
                              const duplicateCount = lines.filter(l => l.part_id && l.part_id === line.part_id).length;
                              const isCatalogPriceSupplier = catalogPriceSuppliers.has(rowKey);
                              return (
                                <tr key={rowKey} className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors">
                                    <td className="p-2 align-middle">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-gray-800 dark:text-slate-100">{line.display_name || line.part_number || line.part_numbers || line.internal_sku || 'Part'}</div>
                                                {!line.part_id && (canCatalogParts ? (
                                                        <button type="button" onClick={() => setCatalogTarget(line)} className="mt-1 inline-flex rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300">
                                                            Catalog &amp; Receive
                                                        </button>
                                                    ) : (
                                                        <span className="mt-1 block text-xs text-yellow-700 dark:text-yellow-300">Requires permission to create parts</span>
                                                    ))}
                                                {line.stock_on_hand !== undefined && line.stock_on_hand !== null && (
                                                    <div className={`text-xs font-medium ${Number(line.stock_on_hand) > 0 ? 'text-gray-500 dark:text-slate-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                                        {Number(line.stock_on_hand) || 0} in stock
                                                    </div>
                                                )}
                                                {duplicateCount > 1 && (
                                                    <div className={`text-[11px] font-semibold mt-0.5 ${isCatalogPriceSupplier ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-slate-500'}`}>
                                                        {isCatalogPriceSupplier ? '✓ Updates catalog price' : 'Duplicate part (won’t update catalog)'}
                                                    </div>
                                                )}
                                                {returned > 0 && (
                                                    <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                                        {returned} returned{line.rejection_reason ? ` — ${line.rejection_reason}` : ''}
                                                        {' · keeping '}{computed?.accepted_quantity ?? 0}
                                                    </div>
                                                )}
                                            </div>
                                            {line.part_id && <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    disabled={loadingEditPartId === line.part_id}
                                                    onClick={() => handleOpenEditPartModal(line)}
                                                    className="inline-flex items-center justify-center h-8 w-8 text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 disabled:opacity-50"
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
                                            </div>}
                                        </div>
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={line.quantity}
                                            onChange={value => handleLineChange(rowKey, 'quantity', value)}
                                            className={inputClass}
                                            disabled={!line.part_id}
                                        />
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={line.cost_price}
                                            onChange={value => handleLineChange(rowKey, 'cost_price', value)}
                                            className={inputClass}
                                            disabled={isFree || !line.part_id}
                                        />
                                        {(isFree || costIsZero) && (
                                            <label className="mt-1 flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={isFree}
                                                    onChange={e => setLineFields(rowKey, {
                                                        is_free_goods: e.target.checked,
                                                        // Marking a line free is a claim that it cost nothing, so the
                                                        // cost has to actually go to zero — the database rejects a
                                                        // free line that still carries a price.
                                                        ...(e.target.checked ? { cost_price: 0 } : {}),
                                                    })}
                                                    className="h-3 w-3 rounded border-gray-300 dark:border-slate-600"
                                                    aria-label={`Free goods: ${line.display_name || line.part_id}`}
                                                />
                                                Free
                                            </label>
                                        )}
                                        {isUncosted && (
                                            <span className="block mt-0.5 text-[10px] text-amber-700 dark:text-amber-400 text-center leading-tight">
                                                no cost — won't affect WAC
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-2 align-middle">
                                        <DiscountInput
                                            compact
                                            percent={line.line_discount_percent ?? null}
                                            amount={line.line_discount_amount ?? null}
                                            onChange={({ percent, amount }) => setLineFields(rowKey, {
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
                                        {computed?.landed_unit_cost == null
                                            ? <span className="text-gray-400 dark:text-slate-500">—</span>
                                            : formatCurrency(computed.landed_unit_cost)}
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={computed?.effective_markup_percent ?? line.effective_markup_percent ?? DEFAULT_MARKUP_PERCENT}
                                            onChange={value => handleMarkupChange(rowKey, value)}
                                            className={`${inputClass} ${belowMinMarkup ? 'border-danger-400 dark:border-danger-600' : ''}`}
                                            aria-label={`Markup for ${line.display_name || line.part_id}`}
                                        />
                                    </td>
                                    <td className="p-2 align-middle">
                                        <MathExpressionInput
                                            value={stagedGrn?.import_provenance && line.sale_price == null ? '' : computed?.sale_price ?? line.sale_price ?? ''}
                                            aria-label={`Sale price for ${line.display_name || line.part_id}`}
                                            allowEmpty={!!stagedGrn?.import_provenance}
                                            onChange={value => handleSalePriceChange(rowKey, value)}
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
                                            {line.part_id ? <button
                                                onClick={() => setReturnTargetLine(line)}
                                                className="inline-flex items-center justify-center h-8 w-8 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30"
                                                title="Reject or return some of this line"
                                            >
                                                <Icon path={ICONS.undo || ICONS.close} className="h-5 w-5"/>
                                            </button> : null}
                                            <button
                                                onClick={() => line.part_id ? removeLine(rowKey) : removeUncatalogedLine(line.po_line_id)}
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
                            disabled={savingDraftRow || posting || duplicateBlocksEntry || !selectedSupplier || lines.length === 0}
                            className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {savingDraftRow ? 'Saving…' : stagedGrn ? 'Update draft' : 'Save as draft'}
                        </button>
                        {canSubmit && (
                            <button
                                onClick={handleSubmitForReview}
                                disabled={savingDraftRow || posting || duplicateBlocksEntry || !selectedSupplier || lines.length === 0}
                                className="px-4 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Submit for review
                            </button>
                        )}
                        <button
                            onClick={handlePostTransaction}
                            disabled={posting || duplicateBlocksEntry || !selectedSupplier || lines.length === 0 || (!!stagedGrn && !canPost)}
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
                        Saved as <span className="font-mono">{stagedGrn.grn_number}</span>
                        {(physicalReceiptNo || stagedGrn.supplier_invoice_no) && (
                            <> · Supplier document: <span className="font-mono font-medium">{physicalReceiptNo || stagedGrn.supplier_invoice_no}</span></>
                        )}
                        {' — nothing has been posted yet. It will be given a permanent receipt number when it is.'}
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
                initialFreightCosts={freightCosts}
                initialMethod={freightMethod}
                onCreateCarrier={canEditSuppliers ? handleCreateCarrier : null}
                overallDiscountPercent={overallDiscount.percent}
                overallDiscountAmount={overallDiscount.amount}
                onApply={({ freight_amount, freight_supplier_id, freight_costs, freight_allocation_method, overrides }) => {
                    setFreightCosts(freight_costs || []);
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

            <Modal isOpen={!!catalogTarget} onClose={() => setCatalogTarget(null)} title="Catalog purchase-order item">
                {catalogPrefill && (
                    <PartForm
                        initialValues={catalogPrefill}
                        uppercaseText
                        brands={brands}
                        groups={groups}
                        onSave={handleCatalogPart}
                        onCancel={() => setCatalogTarget(null)}
                        onBrandGroupAdded={refreshLookupsOnly}
                    />
                )}
            </Modal>

            <Modal
                isOpen={!!markupRounding}
                onClose={() => setMarkupRounding(null)}
                title="Round this price up?"
                maxWidth="max-w-md"
            >
                {markupRounding && (
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600 dark:text-slate-400">
                            {markupRounding.markup}% on <span className="font-medium text-gray-900 dark:text-slate-100">{markupRounding.name}</span>
                            {' '}comes to {formatCurrency(markupRounding.exact)}, which is not a multiple of {PRICE_ROUNDING_INCREMENT}.
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                            <button
                                type="button"
                                autoFocus
                                onClick={() => resolveMarkupRounding(true)}
                                className="w-full text-left px-4 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                            >
                                <span className="block text-sm font-semibold">Round up to {formatCurrency(markupRounding.rounded)}</span>
                                <span className="block text-xs opacity-90">
                                    Markup becomes {markupFromPrice(markupRounding.rounded, markupRounding.landed)?.toFixed(2)}%
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => resolveMarkupRounding(false)}
                                className="w-full text-left px-4 py-3 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                                <span className="block text-sm font-semibold">Keep {markupRounding.markup}% exactly</span>
                                <span className="block text-xs text-gray-500 dark:text-slate-400">
                                    Price stays {formatCurrency(markupRounding.exact)}
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={!!duplicateReview}
                onClose={() => setDuplicateReview(null)}
                title="Supplier document already recorded"
                maxWidth="max-w-xl"
            >
                {duplicateReview && (
                    <div className="space-y-5">
                        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-mono text-base font-bold text-gray-900 dark:text-slate-100">{duplicateReview.grn_number}</p>
                                    <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">
                                        This supplier document is already reserved by an existing goods receipt.
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-amber-200 dark:bg-amber-900/60 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
                                    {duplicateReview.workflow_status || 'Existing'}
                                </span>
                            </div>
                        </div>

                        {duplicateReviewLoading ? (
                            <p className="py-6 text-center text-sm text-gray-500 dark:text-slate-400">Loading existing receipt details…</p>
                        ) : (
                            <>
                                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
                                    <div><dt className="text-gray-500 dark:text-slate-400">Supplier</dt><dd className="font-semibold text-gray-900 dark:text-slate-100">{duplicateReview.supplier_name || '—'}</dd></div>
                                    <div><dt className="text-gray-500 dark:text-slate-400">Supplier document</dt><dd className="font-mono font-semibold text-gray-900 dark:text-slate-100">{duplicateReview.supplier_document_no || duplicateReview.physical_receipt_no || physicalReceiptNo || '—'}</dd></div>
                                    <div><dt className="text-gray-500 dark:text-slate-400">Received</dt><dd className="font-semibold text-gray-900 dark:text-slate-100">{duplicateReview.receipt_date ? new Date(duplicateReview.receipt_date).toLocaleDateString() : '—'}</dd></div>
                                    <div><dt className="text-gray-500 dark:text-slate-400">Line items</dt><dd className="font-semibold text-gray-900 dark:text-slate-100">{duplicateReview.lines?.length ?? '—'}</dd></div>
                                </dl>
                                {duplicateReview.lines?.length > 0 && (
                                    <div className="rounded-lg border border-gray-200 dark:border-slate-700">
                                        <div className="border-b border-gray-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Receipt contents</div>
                                        <ul className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                            {duplicateReview.lines.slice(0, 5).map((line) => (
                                                <li key={line.grn_line_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                                    <span className="min-w-0 truncate text-gray-900 dark:text-slate-100">{line.display_name || line.part_number || line.part_numbers || line.internal_sku || 'Part'}</span>
                                                    <span className="shrink-0 font-mono text-gray-600 dark:text-slate-300">{line.quantity}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        {duplicateReview.lines.length > 5 && <p className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">+{duplicateReview.lines.length - 5} more line items</p>}
                                    </div>
                                )}
                            </>
                        )}

                        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 dark:border-slate-700 pt-4">
                            <button type="button" onClick={() => { setDuplicateReview(null); onNavigate('goods_receipt_history'); }} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">Open receipt history</button>
                            <button type="button" autoFocus onClick={changeDuplicateDocumentNumber} className="px-4 py-2 rounded-lg bg-primary-600 text-sm font-semibold text-white hover:bg-primary-700">Change entered number</button>
                        </div>
                    </div>
                )}
            </Modal>

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
                onBrandGroupAdded={refreshLookupsOnly}

                // State updaters for lines
                _setLines={setLines}
                _lines={lines}
            />
            <DuplicateDialog />

            <ImportExtractedJsonDialog
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onOpenReview={handleOpenImportReview}
                hasDirtyManualForm={!stagedGrn && (lines.length > 0 || !!selectedSupplier || !!physicalReceiptNo)}
                onSaveManualDraftFirst={handleSaveAsDraft}
            />

            {/* Keep review state mounted while the part form and its nested dialogs use the shared modal layer. */}
            <ImportReviewDrawer
                isOpen={isImportReviewDrawerOpen && !importPartTarget}
                onClose={() => setIsImportReviewDrawerOpen(false)}
                reviewState={importReview.review?.review_state}
                sourcePayload={importReview.review?.source_payload}
                version={importReview.review?.version}
                blockers={importReview.review?.blockers || []}
                suppliers={suppliers}
                saving={importReview.saving}
                committing={importReview.committing}
                hasUnsavedChanges={importReview.hasUnsavedChanges}
                candidatesByRow={importReview.candidatesByRow}
                candidatesLoadingRow={importReview.candidatesLoadingRow}
                candidateResultsByRow={importReview.candidateResultsByRow}
                autoMatchProgress={importReview.autoMatchProgress}
                onRetryAutomaticMatching={importReview.retryAutomaticMatching}
                onQueueAction={importReview.queueAction}
                onSaveReview={importReview.saveReview}
                onFetchCandidates={importReview.fetchCandidates}
                onCreatePart={canCatalogParts && importReview.review?.status === 'IN_REVIEW' ? handleCreateImportPart : null}
                onAbandonReview={importReview.abandonReview}
                onCommitReview={importReview.commitReview}
            />
            <Modal
                isOpen={!!importPartTarget}
                onClose={closeImportPartForm}
                title={`Create part for imported line ${importPartTarget?.line_no}`}
                maxWidth="max-w-2xl"
            >
                {importPartTarget && (
                    <fieldset disabled={savingImportPart} className="min-w-0">
                        <PartForm
                            key={`${importPartTarget.import_id}-${importPartTarget.row_id}`}
                            initialValues={importPartTarget.initialValues}
                            uppercaseText
                            brands={brands}
                            groups={groups}
                            onSave={handleSaveImportPart}
                            onCancel={closeImportPartForm}
                            onBrandGroupAdded={refreshLookupsOnly}
                        />
                        {savingImportPart && <p role="status" className="mt-2 text-sm text-gray-500 dark:text-slate-400">Saving part…</p>}
                    </fieldset>
                )}
            </Modal>
        </div>
    );
};

export default GoodsReceiptPage;
