import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import Combobox from '../ui/Combobox';
import SearchBar from '../SearchBar';
import Modal from '../ui/Modal';
import PartForm from './PartForm';
import useDraft from '../../hooks/useDraft';
import { formatApplicationText } from '../../helpers/applicationTextHelper';
import { enrichPartsArray } from '../../helpers/applicationCache';

const PurchaseOrderForm = ({ user, onSave, onCancel, existingPO }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [formData, setFormData] = useState({
        lines: [],
        selectedSupplier: '',
        notes: '',
        expectedDate: ''
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isNewPartOpen, setIsNewPartOpen] = useState(false);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const searchBarRef = useRef(null);
    const isScrollingRef = useRef(false);
    // Draft via reusable hook
    const poDraftData = useMemo(() => formData, [formData]);
    const poIsEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0)), []);
    const { status: poDraftStatus, lastSavedAt: poLastSavedAt, draft: poDraft, loaded: poDraftLoaded, clearDraft: clearPODraft } = useDraft('po', { data: poDraftData, isEmpty: poIsEmpty, debounceMs: 750 });

    const initialFormData = useMemo(() => {
        if (existingPO) {
            return {
                lines: existingPO.lines || [],
                selectedSupplier: existingPO.supplier_id || '',
                notes: existingPO.notes || '',
                expectedDate: existingPO.expected_date ? existingPO.expected_date.split('T')[0] : ''
            };
        } else {
            return {
                lines: [],
                selectedSupplier: '',
                notes: '',
                expectedDate: ''
            };
        }
    }, [existingPO]);

    const isFormDirty = useMemo(() => {
        return JSON.stringify(formData) !== JSON.stringify(initialFormData);
    }, [formData, initialFormData]);

    const isFormElement = (element) => {
        return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
    };

    // --- Load initial data ---
    useEffect(() => {
        api.get('/suppliers?status=active').then(res => setSuppliers(res.data));
        // fetch brands and groups for the New Part modal
        const fetchBrandsAndGroups = async () => {
            try {
                const [b, g] = await Promise.all([api.get('/brands'), api.get('/groups')]);
                setBrands(Array.isArray(b.data) ? b.data : []);
                setGroups(Array.isArray(g.data) ? g.data : []);
            } catch (err) {
                console.error('Could not load brands/groups', err);
            }
        };
        fetchBrandsAndGroups();

        if (existingPO) {
            // If editing, load data from the existing PO
            api.get(`/purchase-orders/${existingPO.po_id}/lines`).then(res => {
                setFormData({
                    lines: res.data,
                    selectedSupplier: existingPO.supplier_id,
                    notes: existingPO.notes || '',
                    expectedDate: existingPO.expected_date ? existingPO.expected_date.split('T')[0] : ''
                });
            });
        }
    }, [existingPO]);

    // --- Debounced auto-save logic ---
    // When PO draft loads (create mode), hydrate once
    useEffect(() => {
        if (existingPO) return;
        if (!poDraftLoaded) return;
        if (poDraft) {
            setFormData(poDraft);
            toast('Loaded your saved draft.', { icon: '📄' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poDraftLoaded]);


    // --- Part search logic ---
    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }
        const fetchParts = async () => {
            const res = await api.get('/power-search/parts', { params: { keyword: searchTerm } });
            const enriched = await enrichPartsArray(res.data || []);
            setSearchResults(enriched);
            // Auto-scroll to search bar on mobile/touch devices
            if (enriched.length > 0 && searchBarRef.current) {
                searchBarRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
        const timer = setTimeout(fetchParts, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // --- Handle search results visibility and page scroll lock ---
    useEffect(() => {
        if (searchResults.length > 0) {
            // Lock page scroll
            document.body.style.overflow = 'hidden';
            // Add click outside listener to hide results
            const handleClickOutside = (e) => {
                if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
                    setSearchResults([]);
                }
            };
            document.addEventListener('click', handleClickOutside);
            return () => {
                document.removeEventListener('click', handleClickOutside);
                document.body.style.overflow = '';
            };
        } else {
            document.body.style.overflow = '';
        }
    }, [searchResults]);

    // Application text formatting is now handled by the helper

    const supplierOptions = useMemo(() => suppliers.map(s => ({ value: s.supplier_id, label: s.supplier_name })), [suppliers]);

    const addPartToLines = (part) => {
        const existingLine = formData.lines.find(line => line.part_id === part.part_id);
        if (!existingLine) {
            const newLines = [...formData.lines, {
                ...part,
                quantity: 1,
                cost_price: part.last_cost || 0
            }];
            setFormData(prev => ({ ...prev, lines: newLines }));
        }
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleLineChange = (partId, field, value) => {
        const numericValue = parseFloat(value) || 0;
        const newLines = formData.lines.map(line =>
            line.part_id === partId ? { ...line, [field]: numericValue } : line
        );
        setFormData(prev => ({ ...prev, lines: newLines }));
    };

    const removeLine = (partId) => {
        const newLines = formData.lines.filter(line => line.part_id !== partId);
        setFormData(prev => ({ ...prev, lines: newLines }));
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSupplierChange = (supplierId) => {
        setFormData(prev => ({ ...prev, selectedSupplier: supplierId }));
    };

    const clearDraftAndCancel = useCallback(async () => {
        if (!existingPO) await clearPODraft();
        onCancel();
    }, [existingPO, clearPODraft, onCancel]);

    const handleSubmit = useCallback((e) => {
        if (e) e.preventDefault();
        // Require at least one line. Supplier will default to the existing "N/A" supplier if not selected.
        if (formData.lines.length === 0) {
            return toast.error('Please add at least one part to the purchase order.');
        }

        // If no supplier selected, try to find the placeholder supplier named "N/A" (case-insensitive).
        let supplierId = formData.selectedSupplier;
        if (!supplierId) {
            const na = suppliers.find(s => s.supplier_name && s.supplier_name.trim().toLowerCase() === 'n/a');
            if (na) {
                supplierId = na.supplier_id;
                toast('No supplier selected — using placeholder "N/A" supplier.', { icon: 'ℹ️' });
            } else {
                return toast.error('Please select a supplier or create an "N/A" supplier.');
            }
        }

        const payload = {
            supplier_id: supplierId,
            employee_id: user.employee_id,
            expected_date: formData.expectedDate || null,
            notes: formData.notes,
            lines: formData.lines.map(({ part_id, quantity, cost_price }) => ({ part_id, quantity, cost_price }))
        };

        const promise = onSave(payload);

        promise.then(async () => {
            if (!existingPO) {
                await clearPODraft();
            }
        }).catch(() => {
            // Error is handled by the parent component's toast.promise
        });
    }, [formData, suppliers, user.employee_id, onSave, existingPO, clearPODraft]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target && isFormElement(e.target)) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSubmit();
            } else if (e.key === 'Escape') {
                if (isFormDirty) {
                    const confirmCancel = window.confirm('You have unsaved changes. Are you sure you want to cancel?');
                    if (!confirmCancel) return;
                }
                clearDraftAndCancel();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, clearDraftAndCancel, isFormDirty]);

    const total = useMemo(() => formData.lines.reduce((sum, line) => sum + (line.quantity * line.cost_price), 0), [formData.lines]);

    return (
        <>
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs font-medium text-slate-600">
                <div className="inline-flex items-center gap-2 text-slate-500">
                    <Icon path={ICONS.history} className="h-4 w-4 text-blue-500" />
                    <span>Auto-save status</span>
                </div>
                <div className="inline-flex items-center gap-2">
                    {poDraftStatus === 'saving' && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                            Saving draft…
                        </span>
                    )}
                    {poDraftStatus === 'saved' && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Draft saved {poLastSavedAt ? `• ${poLastSavedAt.toLocaleTimeString()}` : ''}
                        </span>
                    )}
                    {poDraftStatus === 'error' && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-rose-700">
                            <span className="h-2 w-2 rounded-full bg-rose-500" />
                            Draft save failed
                        </span>
                    )}
                    {poDraftStatus === 'idle' && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-500">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            Ready to edit
                        </span>
                    )}
                </div>
            </div>

            <section className="relative rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                    <div>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Supplier & scheduling</h2>
                        <p className="text-xs text-slate-400">Choose a supplier and set expectations so your team stays aligned.</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase text-blue-600">
                        <Icon path={ICONS.suppliers} className="h-4 w-4" />
                        Supplier details
                    </span>
                </div>
                <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-slate-600">Supplier</span>
                        <Combobox
                            options={supplierOptions}
                            value={formData.selectedSupplier}
                            onChange={handleSupplierChange}
                            placeholder="Select a supplier..."
                        />
                    </label>
                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-slate-600">Expected date</span>
                        <input
                            type="date"
                            name="expectedDate"
                            value={formData.expectedDate}
                            onChange={handleFormChange}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-inner shadow-slate-900/5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                    </label>
                </div>
            </section>

            <section className="relative z-30 rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                    <div>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Parts catalog</h2>
                        <p className="text-xs text-slate-400">Search your inventory to add the exact items you need.</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase text-emerald-600">
                        <Icon path={ICONS.power_search} className="h-4 w-4" />
                        Smart search
                    </span>
                </div>
                <div className="relative space-y-4 px-5 py-5" ref={searchBarRef}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex-1">
                            <SearchBar
                                value={searchTerm}
                                onChange={setSearchTerm}
                                onClear={() => setSearchTerm('')}
                                placeholder="Search for parts to add..."
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsNewPartOpen(true)}
                            className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:-translate-y-0.5 hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        >
                            <Icon path={ICONS.plus} className="mr-2 h-4 w-4" />
                            New part
                        </button>
                    </div>

                    {searchResults.length > 0 && (
                        <ul
                            className="search-results absolute left-0 right-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-2xl shadow-slate-900/10"
                            onTouchStart={(e) => {
                                isScrollingRef.current = true;
                                e.stopPropagation();
                            }}
                            onTouchMove={(e) => {
                                if (isScrollingRef.current && e.currentTarget.scrollHeight > e.currentTarget.clientHeight) {
                                    e.preventDefault();
                                }
                                e.stopPropagation();
                            }}
                            onTouchEnd={() => {
                                isScrollingRef.current = false;
                            }}
                        >
                            {searchResults.map(part => (
                                <li
                                    key={part.part_id}
                                    onClick={() => addPartToLines(part)}
                                    className="cursor-pointer border-b border-slate-100 px-4 py-3 text-sm transition hover:bg-blue-50/80"
                                >
                                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                                        <div className="flex flex-1 items-baseline gap-2 truncate">
                                            <span className="truncate text-sm font-semibold text-slate-700">{part.display_name}</span>
                                            {part.applications && (
                                                <span className="hidden text-xs text-slate-400 sm:block">
                                                    {formatApplicationText(part.applications, { style: 'searchSuggestion' })}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs font-medium text-slate-500">Stock: {typeof part.stock_on_hand !== 'undefined' ? Number(part.stock_on_hand).toFixed(2) : '-'}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            <section className="relative z-20 rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                    <div>
                        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Line items</h2>
                        <p className="text-xs text-slate-400">Adjust quantities and keep a clean overview of every part you’re ordering.</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase text-slate-500">
                        <Icon path={ICONS.box} className="h-4 w-4" />
                        {formData.lines.length} items
                    </span>
                </div>
                <div className="px-5 pb-5">
                    <div className="overflow-hidden rounded-2xl border border-slate-100">
                        <table className="min-w-full table-auto text-left text-sm text-slate-600">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Part</th>
                                    <th className="px-4 py-3 text-center font-semibold">Qty</th>
                                    <th className="px-4 py-3 text-right font-semibold">Cost</th>
                                    <th className="px-4 py-3 text-center font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {formData.lines.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                                            No line items yet — search above to add your first part.
                                        </td>
                                    </tr>
                                )}
                                {formData.lines.map(line => (
                                    <tr key={line.part_id} className="transition hover:bg-blue-50/40">
                                        <td className="px-4 py-3">
                                            <div className="font-semibold text-slate-700">{line.display_name}</div>
                                            <div className="text-xs uppercase tracking-wide text-slate-400">{line.internal_sku || 'SKU pending'}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                value={line.quantity}
                                                onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)}
                                                onFocus={e => e.target.select()}
                                                onMouseUp={e => e.preventDefault()}
                                                className="mx-auto block w-20 rounded-lg border border-slate-200 px-2 py-1 text-center text-sm font-semibold text-slate-700 shadow-inner shadow-slate-900/5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-sm text-slate-700">₱{Number(line.cost_price || 0).toFixed(2)}</td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => removeLine(line.part_id)}
                                                className="inline-flex items-center justify-center rounded-full bg-rose-50 p-2 text-rose-600 transition hover:bg-rose-100"
                                                title="Remove line"
                                            >
                                                <Icon path={ICONS.trash} className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <section className="relative z-10 rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <div className="grid gap-5 px-5 py-5 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                        <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium text-slate-600">Internal notes</span>
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleFormChange}
                                rows={4}
                                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-inner shadow-slate-900/5 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                                placeholder="Optional notes to align your team and suppliers."
                            />
                        </label>
                    </div>
                    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Order summary</p>
                            <p className="mt-2 text-2xl font-semibold text-slate-900">₱{total.toFixed(2)}</p>
                            <p className="text-xs text-slate-400">Total based on quantity × cost per part.</p>
                        </div>
                        <div className="space-y-2 text-xs text-slate-500">
                            <p>Drafts auto-save while you work.</p>
                            <p>Parts availability updates when you add them to the purchase order.</p>
                        </div>
                    </div>
                </div>
            </section>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                    type="button"
                    onClick={clearDraftAndCancel}
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                >
                    <Icon path={ICONS.send} className="mr-2 h-4 w-4" />
                    {existingPO ? 'Update Purchase Order' : 'Create Purchase Order'}
                </button>
            </div>
        </form>

        <Modal isOpen={isNewPartOpen} onClose={() => setIsNewPartOpen(false)} title="Add New Part">
            <PartForm
                part={null}
                brands={brands}
                groups={groups}
                onSave={(payload) => {
                    const promise = api.post('/parts', payload);
                    toast.promise(promise, {
                        loading: 'Creating part...',
                        success: (res) => {
                            const newPart = res.data;
                            addPartToLines({
                                part_id: newPart.part_id,
                                display_name: newPart.display_name || newPart.detail || (newPart.brand_name ? `${newPart.brand_name} ${newPart.detail}` : ''),
                                last_cost: newPart.last_cost || 0,
                                ...newPart
                            });
                            setIsNewPartOpen(false);
                            return 'Part created and added to PO';
                        },
                        error: 'Failed to create part.'
                    });
                    return promise;
                }}
                onCancel={() => setIsNewPartOpen(false)}
                onBrandGroupAdded={async () => {
                    try {
                        const [b, g] = await Promise.all([api.get('/brands'), api.get('/groups')]);
                        setBrands(Array.isArray(b.data) ? b.data : []);
                        setGroups(Array.isArray(g.data) ? g.data : []);
                    } catch (err) {
                        console.error('Could not refresh brands/groups', err);
                    }
                }}
            />
        </Modal>
        </>
    );
};

export default PurchaseOrderForm;
