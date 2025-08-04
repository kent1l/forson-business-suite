import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const InvoicingPage = ({ user }) => {
    const [customers, setCustomers] = useState([]);
    const [parts, setParts] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                const [customersRes, partsRes] = await Promise.all([
                    axios.get('http://localhost:3001/api/customers'),
                    axios.get('http://localhost:3001/api/parts')
                ]);
                setCustomers(customersRes.data);
                setParts(partsRes.data);
            } catch (err) {
                console.error("Failed to fetch initial data for invoicing", err);
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
            setLines([...lines, { ...part, part_id: part.part_id, quantity: 1, sale_price: part.last_sale_price || 0 }]);
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

    const handlePostInvoice = async () => {
        if (!selectedCustomer || lines.length === 0) {
            toast.error('Please select a customer and add at least one item.');
            return;
        }

        const payload = {
            customer_id: selectedCustomer,
            employee_id: user.employee_id,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price,
            })),
        };

        const promise = axios.post('http://localhost:3001/api/invoices', payload);

        toast.promise(promise, {
            loading: 'Posting invoice...',
            success: () => {
                setLines([]);
                setSelectedCustomer('');
                return 'Invoice created successfully!';
            },
            error: 'Failed to create invoice.',
        });
    };

    if (loading) return <p>Loading data...</p>;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">New Invoice</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                    <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="">Select a Customer</option>
                        {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>)}
                    </select>
                </div>
                
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

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="border-b">
                            <tr>
                                <th className="p-3 text-sm font-semibold text-gray-600">Part Detail</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-28">Quantity</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-32">Sale Price</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(line => (
                                <tr key={line.part_id} className="border-b">
                                    <td className="p-2 text-sm font-medium text-gray-800">{line.detail}</td>
                                    <td className="p-2"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2"><input type="number" value={line.sale_price} onChange={e => handleLineChange(line.part_id, 'sale_price', e.target.value)} className="w-full p-1 border rounded-md" /></td>
                                    <td className="p-2 text-center"><button onClick={() => removeLine(line.part_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex justify-end pt-4 border-t">
                    <button onClick={handlePostInvoice} className="bg-green-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-green-700 transition">
                        Post Invoice
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InvoicingPage;
