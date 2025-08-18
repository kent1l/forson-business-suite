import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import Combobox from '../ui/Combobox';

const PurchaseOrderForm = ({ user, onSave, onCancel }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');
    const [notes, setNotes] = useState('');
    const [expectedDate, setExpectedDate] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);

    useEffect(() => {
        api.get('/suppliers?status=active').then(res => setSuppliers(res.data));
    }, []);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }
        const fetchParts = async () => {
            const res = await api.get('/power-search/parts', { params: { keyword: searchTerm } });
            setSearchResults(res.data);
        };
        const timer = setTimeout(fetchParts, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const supplierOptions = useMemo(() => suppliers.map(s => ({ value: s.supplier_id, label: s.supplier_name })), [suppliers]);

    const addPartToLines = (part) => {
        const existingLine = lines.find(line => line.part_id === part.part_id);
        if (!existingLine) {
            setLines([...lines, {
                ...part,
                quantity: 1,
                cost_price: part.last_cost || 0
            }]);
        }
        setSearchTerm('');
        setSearchResults([]);
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

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!selectedSupplier || lines.length === 0) {
            return toast.error('Please select a supplier and add at least one part.');
        }
        const payload = {
            supplier_id: selectedSupplier,
            employee_id: user.employee_id,
            expected_date: expectedDate || null,
            notes,
            lines: lines.map(({ part_id, quantity, cost_price }) => ({ part_id, quantity, cost_price }))
        };
        onSave(payload);
    };

    const total = useMemo(() => lines.reduce((sum, line) => sum + (line.quantity * line.cost_price), 0), [lines]);

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <Combobox
                        options={supplierOptions}
                        value={selectedSupplier}
                        onChange={setSelectedSupplier}
                        placeholder="Select a supplier..."
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expected Date</label>
                    <input
                        type="date"
                        value={expectedDate}
                        onChange={e => setExpectedDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
            </div>
            <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Add Part</label>
                <input
                    type="text"
                    placeholder="Search for parts to add..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                {searchResults.length > 0 && (
                    <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-48 overflow-y-auto">
                        {searchResults.map(part => (
                            <li key={part.part_id} onClick={() => addPartToLines(part)} className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm">
                                {part.display_name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="max-h-64 overflow-y-auto border rounded-lg">
                <table className="w-full text-left text-sm">
                    <tbody>
                        {lines.map(line => (
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
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2"></textarea>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create Purchase Order</button>
            </div>
        </form>
    );
};

export default PurchaseOrderForm;