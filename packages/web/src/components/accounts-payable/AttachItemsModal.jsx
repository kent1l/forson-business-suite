import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import MathExpressionInput from '../ui/MathExpressionInput';
import { ICONS } from '../../constants';
import { formatCurrency } from '../../utils/currency';
import { enrichPartsArray } from '../../helpers/applicationCache';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Attaches items to a pre-existing (manually-created) supplier_bill by posting a
 * real Goods Receipt against it — this is the point where a manual payable actually
 * moves inventory, via the same POST /goods-receipts endpoint the main Goods Receipt
 * page uses, just scoped with bill_id so it doesn't also auto-create a new bill.
 */
const AttachItemsModal = ({ isOpen, onClose, supplierId, supplierName, bill, onAttached }) => {
    const { user } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [lines, setLines] = useState([]);
    const [posting, setPosting] = useState(false);
    const debounceRef = useRef(null);

    useEffect(() => {
        if (!isOpen) { setLines([]); setSearchTerm(''); setSearchResults([]); }
    }, [isOpen]);

    useEffect(() => {
        if (!searchTerm.trim()) { setSearchResults([]); return; }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            try {
                const { data } = await api.get('/power-search/parts', { params: { keyword: searchTerm } });
                setSearchResults(await enrichPartsArray(data || []));
            } catch {
                toast.error('Search failed.');
            }
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchTerm]);

    const addPart = (part) => {
        setLines((prev) => {
            const existing = prev.find(l => l.part_id === part.part_id);
            if (existing) {
                return prev.map(l => l.part_id === part.part_id ? { ...l, quantity: l.quantity + 1 } : l);
            }
            return [...prev, {
                part_id: part.part_id,
                display_name: part.display_name,
                quantity: 1,
                cost_price: typeof part.last_cost !== 'undefined' ? part.last_cost : 0,
            }];
        });
        setSearchTerm('');
        setSearchResults([]);
    };

    const updateLine = (partId, field, value) => {
        const numeric = typeof value === 'number' ? value : (parseFloat(value) || 0);
        setLines(lines.map(l => l.part_id === partId ? { ...l, [field]: numeric } : l));
    };

    const removeLine = (partId) => setLines(lines.filter(l => l.part_id !== partId));

    const itemsTotal = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.cost_price) || 0), 0);

    const handleSubmit = async () => {
        if (lines.length === 0) { toast.error('Add at least one item'); return; }
        setPosting(true);
        try {
            await api.post('/goods-receipts', {
                supplier_id: supplierId,
                received_by: user.employee_id,
                bill_id: bill.bill_id,
                lines: lines.map(l => ({ part_id: l.part_id, quantity: l.quantity, cost_price: l.cost_price, sale_price: l.cost_price })),
            });
            toast.success('Items attached — stock received');
            onAttached && onAttached();
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to attach items');
        } finally {
            setPosting(false);
        }
    };

    if (!bill) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Attach Items — ${bill.bill_number || `Bill #${bill.bill_id}`}`} maxWidth="max-w-2xl">
            <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                    Receiving items here creates a real goods receipt for <span className="font-medium text-gray-700 dark:text-slate-300">{supplierName}</span> and increases stock, linked to this payable.
                </p>

                <div className="relative">
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search by part name or SKU..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    {searchResults.length > 0 && (
                        <ul className="absolute z-10 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md mt-1 shadow-lg max-h-48 overflow-y-auto">
                            {searchResults.map((part) => (
                                <li key={part.part_id} onClick={() => addPart(part)}
                                    className="px-4 py-2 cursor-pointer hover:bg-primary-50 dark:hover:bg-slate-700/60 text-sm text-gray-800 dark:text-slate-100 truncate">
                                    {part.display_name}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
                            <tr>
                                <th className="p-2 font-semibold text-gray-600 dark:text-slate-300">Part</th>
                                <th className="p-2 font-semibold text-gray-600 dark:text-slate-300 w-20 text-center">Qty</th>
                                <th className="p-2 font-semibold text-gray-600 dark:text-slate-300 w-28 text-center">Cost</th>
                                <th className="p-2 font-semibold text-gray-600 dark:text-slate-300 w-24 text-right">Total</th>
                                <th className="p-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line) => (
                                <tr key={line.part_id} className="border-b border-gray-100 dark:border-slate-700">
                                    <td className="p-2 text-gray-800 dark:text-slate-100 truncate max-w-[10rem]">{line.display_name}</td>
                                    <td className="p-2">
                                        <MathExpressionInput
                                            precision={2}
                                            value={line.quantity}
                                            onChange={(val) => updateLine(line.part_id, 'quantity', val)}
                                            className="w-full h-8 px-1 text-center border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded"
                                        />
                                    </td>
                                    <td className="p-2">
                                        <MathExpressionInput
                                            precision={2}
                                            value={line.cost_price}
                                            onChange={(val) => updateLine(line.part_id, 'cost_price', val)}
                                            className="w-full h-8 px-1 text-center border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded"
                                        />
                                    </td>
                                    <td className="p-2 text-right font-mono text-gray-900 dark:text-slate-100">
                                        {formatCurrency((parseFloat(line.quantity) || 0) * (parseFloat(line.cost_price) || 0))}
                                    </td>
                                    <td className="p-2 text-center">
                                        <button onClick={() => removeLine(line.part_id)} className="text-danger-500 dark:text-danger-400 hover:text-danger-700">
                                            <Icon path={ICONS.trash} className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {lines.length === 0 && (
                                <tr><td colSpan="5" className="p-4 text-center text-gray-500 dark:text-slate-400">No items added yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center justify-between text-sm border-t border-gray-200 dark:border-slate-700 pt-3">
                    <div className="space-y-0.5">
                        <div>Items Total: <span className="font-mono font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(itemsTotal)}</span></div>
                        <div>Bill Total: <span className="font-mono text-gray-600 dark:text-slate-400">{formatCurrency(bill.total_amount)}</span></div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                        <button onClick={handleSubmit} disabled={posting || lines.length === 0}
                            className="px-4 py-2 bg-success-600 text-white rounded-lg hover:bg-success-700 disabled:opacity-50">
                            {posting ? 'Receiving...' : 'Attach & Receive Stock'}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default AttachItemsModal;
