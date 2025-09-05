import { useState, useEffect, useMemo } from 'react';
import api from '../../api'; // <-- CORRECTED PATH
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import Combobox from '../ui/Combobox';
import SearchBar from '../SearchBar';
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
    // Draft via reusable hook
    const poDraftData = useMemo(() => formData, [formData]);
    const poIsEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0)), []);
    const { status: poDraftStatus, lastSavedAt: poLastSavedAt, draft: poDraft, loaded: poDraftLoaded, clearDraft: clearPODraft } = useDraft('po', { data: poDraftData, isEmpty: poIsEmpty, debounceMs: 750 });

    // --- Load initial data ---
    useEffect(() => {
        api.get('/suppliers?status=active').then(res => setSuppliers(res.data));

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

    const clearDraftAndCancel = async () => {
    if (!existingPO) await clearPODraft();
        onCancel();
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.selectedSupplier || formData.lines.length === 0) {
            return toast.error('Please select a supplier and add at least one part.');
        }
        const payload = {
            supplier_id: formData.selectedSupplier,
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
    };

    const total = useMemo(() => formData.lines.reduce((sum, line) => sum + (line.quantity * line.cost_price), 0), [formData.lines]);

    return (
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
                <SearchBar
                    value={searchTerm}
                    onChange={setSearchTerm}
                    onClear={() => setSearchTerm('')}
                    placeholder="Search for parts to add..."
                />
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
            <div className="max-h-64 overflow-y-auto border rounded-lg">
                <table className="w-full text-left text-sm">
                    <tbody>
                        {formData.lines.map(line => (
                            <tr key={line.part_id} className="border-b">
                                <td className="p-2">{line.display_name}</td>
                                <td className="p-2 w-24"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                <td className="p-2 w-28"><input type="number" step="0.01" value={line.cost_price} onChange={e => handleLineChange(line.part_id, 'cost_price', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                <td className="p-2 w-12 text-center"><button type="button" onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-4 w-4" /></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="text-right font-bold">Total: ₱{total.toFixed(2)}</div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea name="notes" value={formData.notes} onChange={handleFormChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2"></textarea>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={clearDraftAndCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{existingPO ? 'Update Purchase Order' : 'Create Purchase Order'}</button>
            </div>
        </form>
    );
};

export default PurchaseOrderForm;
