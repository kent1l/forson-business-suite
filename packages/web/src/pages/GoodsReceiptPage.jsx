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
import { formatCurrency } from '../utils/currency';

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

    // Reusable draft hook
    const draftData = useMemo(() => ({ selectedSupplier, lines, selectedPO }), [selectedSupplier, lines, selectedPO]);
    const isEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0) && !d?.selectedPO), []);
    const { status: draftStatus, lastSavedAt, draft, loaded: draftLoaded, clearDraft } = useDraft('goods-receipt', { data: draftData, isEmpty, debounceMs: 750 });

    const totals = useMemo(() => {
        const totalQuantity = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0), 0);
        const totalCost = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.cost_price) || 0), 0);
        const totalSaleValue = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.sale_price) || 0), 0);
        return { totalQuantity, totalCost, totalSaleValue, lineCount: lines.length };
    }, [lines]);

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
    useDeepLink(pageState, ({ expensePrefill: incoming }) => {
        if (!incoming) return;
        setExpensePrefill(incoming);
        if (incoming.description) setSearchTerm('');
    });

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
                sale_price: typeof part.last_sale_price !== 'undefined' ? part.last_sale_price : 0
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

    const removeLine = (partId) => {
        setLines(lines.filter(line => line.part_id !== partId));
    };

    const handlePostTransaction = async () => {
        if (!selectedSupplier || lines.length === 0) {
            toast.error('Please select a supplier and add at least one item.');
            return;
        }

        const payload = {
            supplier_id: selectedSupplier,
            received_by: user.employee_id,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                cost_price: line.cost_price,
                sale_price: line.sale_price,
            })),
            po_id: selectedPO ? selectedPO.po_id : null,
        };

        setPosting(true);
        const promise = api.post('/goods-receipts', payload);

        toast.promise(promise, {
            loading: 'Posting transaction...',
            success: () => {
                setLines([]);
                setSelectedSupplier('');
                setSelectedPO('');
                fetchInitialData(); // Refresh PO list
                clearDraft();
                setPosting(false);
                return 'Goods receipt created successfully!';
            },
            error: () => {
                setPosting(false);
                return 'Failed to create goods receipt.';
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
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100">New Goods Receipt</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Receive stock from a supplier, against a purchase order or directly.</p>
                </div>
                <button
                    onClick={() => onNavigate('goods_receipt_history')}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition text-sm font-medium flex items-center gap-1.5"
                >
                    <Icon path={ICONS.history} className="h-4 w-4" /> View History
                </button>
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
                        <select value={selectedPO ? selectedPO.po_id : ''} onChange={e => handleSelectPO(e.target.value)} className={selectClass}>
                            <option value="">-- Select a PO --</option>
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
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-center">
                                    <span className="inline-flex items-center gap-1">
                                        Sale Price
                                        <InfoTip label="Sale Price">
                                            The price you intend to sell the part at going forward. Optional per
                                            line — defaults to the part's last sale price if known.
                                        </InfoTip>
                                    </span>
                                </th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-32 text-right">Line Total</th>
                                <th className="p-3 text-xs font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => (
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
                                        <MathExpressionInput
                                            value={line.sale_price}
                                            onChange={value => handleLineChange(line.part_id, 'sale_price', value)}
                                            className={inputClass}
                                        />
                                    </td>
                                    <td className="p-2 align-middle text-right font-mono text-sm font-medium text-gray-900 dark:text-slate-100">
                                        {formatCurrency((parseFloat(line.quantity) || 0) * (parseFloat(line.cost_price) || 0))}
                                    </td>
                                    <td className="p-2 align-middle text-center">
                                        <button
                                            onClick={() => removeLine(line.part_id)}
                                            className="inline-flex items-center justify-center h-8 w-8 text-danger-500 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 rounded hover:bg-danger-50 dark:hover:bg-danger-900/30"
                                            title="Remove"
                                        >
                                            <Icon path={ICONS.trash} className="h-5 w-5"/>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {lines.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">
                                        No items added yet. Search for a part above, scan a barcode, or select a purchase order to begin.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-sm">
                        <div>
                            <span className="text-gray-500 dark:text-slate-400">Items: </span>
                            <span className="font-semibold text-gray-900 dark:text-slate-100">{totals.lineCount}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-slate-400">Total Quantity: </span>
                            <span className="font-semibold text-gray-900 dark:text-slate-100">{totals.totalQuantity.toLocaleString()}</span>
                        </div>
                        <div>
                            <span className="text-gray-500 dark:text-slate-400">Total Cost: </span>
                            <span className="font-mono font-bold text-lg text-gray-900 dark:text-slate-100">{formatCurrency(totals.totalCost)}</span>
                        </div>
                    </div>
                    <button
                        onClick={handlePostTransaction}
                        disabled={posting || !selectedSupplier || lines.length === 0}
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
