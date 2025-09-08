import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api'; // <-- CORRECTED PATH
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
import QuantityInput from '../ui/QuantityInput';

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
        };
        const timer = setTimeout(fetchParts, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

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
        const newLines = formData.lines.map(line => {
            if (line.part_id === partId) {
                const numericValue = parseFloat(value);
                // Ensure quantity is at least 1
                if (field === 'quantity' && numericValue < 1) {
                    return { ...line, [field]: 1 };
                }
                return { ...line, [field]: isNaN(numericValue) ? '' : numericValue };
            }
            return line;
        });
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
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Draft saved indicator */}
            <div className="flex items-center justify-end text-xs text-gray-500">
                {poDraftStatus === 'saving' && <span>Saving draft…</span>}
                {poDraftStatus === 'saved' && (
                    <span>Draft saved{poLastSavedAt ? ` at ${poLastSavedAt.toLocaleTimeString()}` : ''}</span>
                )}
                {poDraftStatus === 'error' && <span className="text-red-600">Draft save failed</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <Combobox
                        options={supplierOptions}
                        value={formData.selectedSupplier}
                        onChange={handleSupplierChange}
                        placeholder="Select a supplier..."
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expected Date</label>
                    <input
                        type="date"
                        name="expectedDate"
                        value={formData.expectedDate}
                        onChange={handleFormChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
            </div>
            <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Add Part</label>
                <div className="flex items-center space-x-2">
                    <div className="flex-grow">
                        <SearchBar
                            value={searchTerm}
                            onChange={setSearchTerm}
                            onClear={() => setSearchTerm('')}
                            placeholder="Search for parts to add..."
                        />
                    </div>
                    <div>
                        <button type="button" onClick={() => setIsNewPartOpen(true)} className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">New Part</button>
                    </div>
                </div>
                {searchResults.length > 0 && (
                    <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg search-results">
                        {searchResults.map(part => (
                            <li key={part.part_id} onClick={() => addPartToLines(part)} className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm">
                                <div className="flex items-baseline space-x-2">
                                    <div className="text-sm font-medium text-gray-800 truncate">{part.display_name}</div>
                                    {part.applications && <div className="text-xs text-gray-500 truncate">{formatApplicationText(part.applications, { style: 'searchSuggestion' })}</div>}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* PO Lines - Responsive Table/Card View */}
            <div className="space-y-2 md:border md:rounded-lg md:max-h-72 md:overflow-y-auto">
                {/* Header for desktop */}
                <div className="hidden md:grid md:grid-cols-[1fr_auto_auto] md:gap-x-4 md:p-2 md:border-b bg-gray-50 rounded-t-lg sticky top-0">
                    <div className="font-semibold text-sm text-gray-600">Part</div>
                    <div className="font-semibold text-sm text-gray-600 text-center">Quantity</div>
                    <div className="font-semibold text-sm text-gray-600"></div>
                </div>

                {formData.lines.length === 0 && (
                    <div className="text-center text-gray-500 py-8">No parts added yet.</div>
                )}

                {/* Lines */}
                {formData.lines.map(line => (
                    <div key={line.part_id} className="p-3 border rounded-lg md:border-none md:p-0 md:rounded-none md:grid md:grid-cols-[1fr_auto_auto] md:gap-x-4 md:items-center md:px-2 md:py-3 hover:bg-gray-50">
                        {/* Part Name */}
                        <div className="font-medium text-gray-800 mb-2 md:mb-0">{line.display_name}</div>

                        {/* Quantity */}
                        <div className="flex justify-between items-center mb-3 md:mb-0 md:block">
                            <label className="md:hidden text-sm text-gray-600">Quantity:</label>
                            <QuantityInput
                                value={line.quantity}
                                onChange={value => handleLineChange(line.part_id, 'quantity', value)}
                            />
                        </div>

                        {/* Remove Button */}
                        <div className="flex justify-end md:justify-center">
                            <button type="button" onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700 p-2 rounded-md hover:bg-red-100">
                                <Icon path={ICONS.trash} className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Total */}
            <div className="text-right font-bold text-lg pr-2">Total: ₱{total.toFixed(2)}</div>

            {/* Notes */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleFormChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2"></textarea>
            </div>

            {/* Action Buttons - Sticky Footer on Mobile */}
            <div className="mt-6 flex justify-end space-x-4 md:static fixed bottom-0 left-0 right-0 bg-white p-4 border-t md:border-t-0 md:p-0 md:bg-transparent">
                <button type="button" onClick={clearDraftAndCancel} className="flex-1 md:flex-none px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="flex-1 md:flex-none px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{existingPO ? 'Update Purchase Order' : 'Create Purchase Order'}</button>
            </div>
        </form>

        {/* New Part modal (outside outer form) */}
        <Modal isOpen={isNewPartOpen} onClose={() => setIsNewPartOpen(false)} title="Add New Part">
            <PartForm
                part={null}
                brands={brands}
                groups={groups}
                onSave={(payload) => {
                    // create the part and add to lines on success
                    const promise = api.post('/parts', payload);
                    toast.promise(promise, {
                        loading: 'Creating part...',
                        success: (res) => {
                            const newPart = res.data;
                            // ensure minimal fields and add to lines
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
                    // refresh brands/groups if a new one was created inside the PartForm
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
