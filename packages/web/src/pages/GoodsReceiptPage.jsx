import { useState, useEffect, useMemo } from 'react';
import useTypeahead from '../hooks/useTypeahead';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import Icon from '../components/ui/Icon';
import Combobox from '../components/ui/Combobox';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import SupplierForm from '../components/forms/SupplierForm';
import PartForm from '../components/forms/PartForm';
import useDraft from '../hooks/useDraft';

const GoodsReceiptPage = ({ user }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const resultsId = 'goods-receipt-search-results';
    const inputId = 'goods-receipt-search-input';

    const { getInputProps, getItemProps, reset } = useTypeahead({ items: searchResults, onSelect: (item) => { addPartToLines(item); setSearchResults([]); }, inputId, listboxId: resultsId });
    const [loading, setLoading] = useState(true);
    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
    const [isNewPartModalOpen, setIsNewPartModalOpen] = useState(false);
    const [openPOs, setOpenPOs] = useState([]);
    const [selectedPO, setSelectedPO] = useState('');

    // Reusable draft hook
    const draftData = useMemo(() => ({ selectedSupplier, lines, selectedPO }), [selectedSupplier, lines, selectedPO]);
    const isEmpty = useMemo(() => (d) => (!d?.selectedSupplier && (!d?.lines || d.lines.length === 0) && !d?.selectedPO), []);
    const { status: draftStatus, lastSavedAt, draft, loaded: draftLoaded, clearDraft } = useDraft('goods-receipt', { data: draftData, isEmpty, debounceMs: 750 });

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
                setSearchResults(response.data);
            } catch {
                toast.error("Search failed.");
            }
        };

        const debounceTimer = setTimeout(fetchSearchResults, 300);
        return () => clearTimeout(debounceTimer);
    }, [searchTerm]);

    const renderApplicationsText = (apps) => {
        if (!apps) return null;
        if (typeof apps === 'string') return apps;
        if (Array.isArray(apps)) {
            return apps.map(a => {
                if (!a) return '';
                if (typeof a === 'string') return a;
                if (typeof a === 'object') return a.display || [a.make, a.model, a.engine].filter(Boolean).join(' ');
                return String(a);
            }).filter(Boolean).join(', ');
        }
        if (typeof apps === 'object') {
            return apps.display || [apps.make, apps.model, apps.engine].filter(Boolean).join(' ');
        }
        return String(apps);
    };

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
                return 'Part added and added to receipt!';
            },
            error: 'Failed to save part.'
        });
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
                cost_price: part.last_cost || 0,
                sale_price: part.last_sale_price || 0 
            }]);
        }
        setSearchTerm('');
    };

    const handleLineChange = (partId, field, value) => {
        const numericValue = parseFloat(value) || 0;
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

        const promise = api.post('/goods-receipts', payload);

    toast.promise(promise, {
            loading: 'Posting transaction...',
            success: () => {
                setLines([]);
                setSelectedSupplier('');
                setSelectedPO('');
                fetchInitialData(); // Refresh PO list
        clearDraft();
                return 'Goods receipt created successfully!';
            },
            error: 'Failed to create goods receipt.',
        });
    };

    if (loading) return <p>Loading data...</p>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">New Goods Receipt</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-6">
                {/* Draft saved indicator */}
                <div className="flex items-center justify-end text-xs text-gray-500">
                    {draftStatus === 'saving' && <span>Saving draft…</span>}
                    {draftStatus === 'saved' && (
                        <span>Draft saved{lastSavedAt ? ` at ${lastSavedAt.toLocaleTimeString()}` : ''}</span>
                    )}
                    {draftStatus === 'error' && <span className="text-red-600">Draft save failed</span>}
                        {(draftStatus === 'saved' || draftStatus === 'saving' || draft) && (
                            <button
                                type="button"
                                onClick={async () => { await clearDraft(); toast.success('Draft cleared'); }}
                                className="text-sm text-gray-600 hover:text-gray-800 ml-3"
                            >
                                Clear Draft
                            </button>
                        )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Receive Against Purchase Order (Optional)</label>
                        <select value={selectedPO ? selectedPO.po_id : ''} onChange={e => handleSelectPO(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                            <option value="">-- Select a PO --</option>
                            {openPOs.map(po => <option key={po.po_id} value={po.po_id}>{po.po_number} - {po.supplier_name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
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
                            <button onClick={() => setIsSupplierModalOpen(true)} className="px-3 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 text-sm" disabled={!!selectedPO}>New</button>
                        </div>
                    </div>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Add Part Manually</label>
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <SearchBar
                                {...getInputProps()}
                                value={searchTerm}
                                onChange={setSearchTerm}
                                onClear={() => { setSearchTerm(''); reset(); }}
                                placeholder="Search by part name or SKU..."
                                disabled={!!selectedPO}
                            />
                            {searchResults.length > 0 && (
                                <ul id={resultsId} role="listbox" className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg search-results">
                                    {searchResults.map((part, idx) => {
                                        const itemProps = getItemProps(idx);
                                        return (
                                                <li
                                                    key={part.part_id}
                                                    {...itemProps}
                                                    className={`px-4 py-2 cursor-pointer ${itemProps['aria-selected'] ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                                                >
                                                    <div className="flex items-baseline space-x-2">
                                                        <div className="text-sm font-medium text-gray-800 truncate">{part.display_name}</div>
                                                        {part.applications && <div className="text-xs text-gray-500 truncate">{renderApplicationsText(part.applications)}</div>}
                                                    </div>
                                                </li>
                                            );
                                    })}
                                </ul>
                            )}
                        </div>
                        <button onClick={() => setIsNewPartModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition whitespace-nowrap" disabled={!!selectedPO}>
                           New Part
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">Part Detail</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-28">Quantity</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-32">Cost Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-32">Sale Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => (
                                <tr key={line.part_id} className="border-b">
                                    <td className="p-2 text-sm font-medium text-gray-800">{line.display_name}</td>
                                    <td className="p-2"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                        <td className="p-2"><input type="number" step="0.01" value={line.cost_price} onChange={e => handleLineChange(line.part_id, 'cost_price', e.target.value)} onFocus={e => e.target.select()} className="w-full p-1 border rounded-md" /></td>
                                        <td className="p-2"><input type="number" step="0.01" value={line.sale_price} onChange={e => handleLineChange(line.part_id, 'sale_price', e.target.value)} onFocus={e => e.target.select()} className="w-full p-1 border rounded-md" /></td>
                                        <td className="p-2 text-center"><button onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <button onClick={handlePostTransaction} className="bg-green-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-700 transition">
                        Post Transaction
                    </button>
                </div>
            </div>
            <Modal isOpen={isSupplierModalOpen} onClose={() => setIsSupplierModalOpen(false)} title="Add New Supplier">
                <SupplierForm onSave={handleNewSupplierSave} onCancel={() => setIsSupplierModalOpen(false)} />
            </Modal>
            <Modal isOpen={isNewPartModalOpen} onClose={() => setIsNewPartModalOpen(false)} title="Add New Part">
                <PartForm
                    brands={brands}
                    groups={groups}
                    onSave={handleSaveNewPart}
                    onCancel={() => setIsNewPartModalOpen(false)}
                    onBrandGroupAdded={fetchInitialData}
                />
            </Modal>
        </div>
    );
};

export default GoodsReceiptPage;