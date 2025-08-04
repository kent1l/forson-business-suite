import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const GoodsReceiptPage = ({ user }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [parts, setParts] = useState([]);
    const [lines, setLines] = useState([]); // Simulates tblGRN_TempLines
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fetch initial data for suppliers and parts dropdowns/search
        const fetchData = async () => {
            try {
                setLoading(true);
                const [suppliersRes, partsRes] = await Promise.all([
                    axios.get('http://localhost:3001/api/suppliers'),
                    axios.get('http://localhost:3001/api/parts')
                ]);
                setSuppliers(suppliersRes.data);
                setParts(partsRes.data);
            } catch (err) {
                console.error("Failed to fetch initial data for goods receipt", err);
                toast.error("Failed to load initial data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }
        setSearchResults(
            parts.filter(p =>
                p.detail.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (p.internal_sku && p.internal_sku.toLowerCase().includes(searchTerm.toLowerCase()))
            ).slice(0, 5)
        );
    }, [searchTerm, parts]);

    const addPartToLines = (part) => {
        const existingLine = lines.find(line => line.part_id === part.part_id);
        if (existingLine) {
            setLines(lines.map(line =>
                line.part_id === part.part_id ? { ...line, quantity: line.quantity + 1 } : line
            ));
        } else {
            setLines([...lines, { ...part, part_id: part.part_id, quantity: 1, cost_price: part.last_cost || 0 }]);
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
            })),
        };

        const promise = axios.post('http://localhost:3001/api/goods-receipts', payload);

        toast.promise(promise, {
            loading: 'Posting transaction...',
            success: () => {
                setLines([]);
                setSelectedSupplier('');
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
                {/* Header */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <select value={selectedSupplier} onChange={e => setSelectedSupplier(e.target.value)} className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="">Select a Supplier</option>
                        {suppliers.map(s => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}
                    </select>
                </div>
                
                {/* Part Search */}
                <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Add Part</label>
                    <div className="relative">
                        <Icon path={ICONS.search} className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by part name or SKU..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full px-3 py-2 pl-10 border border-gray-300 rounded-lg"
                        />
                    </div>
                    {searchResults.length > 0 && (
                        <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg">
                            {searchResults.map(part => (
                                <li key={part.part_id} onClick={() => addPartToLines(part)} className="px-4 py-2 hover:bg-blue-50 cursor-pointer">
                                    <strong>{part.detail}</strong> ({part.internal_sku})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Line Items Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">Part Detail</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-28">Quantity</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-32">Cost Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => (
                                <tr key={line.part_id} className="border-b">
                                    <td className="p-2 text-sm font-medium text-gray-800">{line.detail}</td>
                                    <td className="p-2"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2"><input type="number" value={line.cost_price} onChange={e => handleLineChange(line.part_id, 'cost_price', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2 text-center"><button onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Post Button */}
                <div className="flex justify-end pt-4 border-t">
                    <button onClick={handlePostTransaction} className="bg-green-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-700 transition">
                        Post Transaction
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GoodsReceiptPage;
