import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import Modal from '../components/ui/Modal';
import CustomerForm from '../components/forms/CustomerForm';
import Combobox from '../components/ui/Combobox';

const PriceQuantityModal = ({ item, onConfirm, onCancel }) => {
    const [price, setPrice] = useState(item.sale_price || 0);
    const [quantity, setQuantity] = useState(1);
    const priceInputRef = useRef(null);

    useEffect(() => {
        if (priceInputRef.current) {
            priceInputRef.current.select();
        }
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm({ ...item, sale_price: parseFloat(price), quantity: parseInt(quantity, 10) });
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sale Price</label>
                    <input
                        ref={priceInputRef}
                        type="number"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                    <input
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                        min="1"
                    />
                </div>
            </div>
            <div className="mt-6 flex justify-end">
                <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Add to Sale
                </button>
            </div>
        </form>
    );
};

const POSPage = ({ user, lines, setLines }) => {
    const { settings } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');
    const [parts, setParts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [currentItem, setCurrentItem] = useState(null);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const searchInputRef = useRef(null);
    
    const walkInCustomer = { customer_id: 1, first_name: 'Walk-in', last_name: 'Customer' };

    useEffect(() => {
        axios.get('http://localhost:3001/api/parts?status=active').then(res => setParts(res.data));
        axios.get('http://localhost:3001/api/customers?status=active').then(res => setCustomers([walkInCustomer, ...res.data]));
        setSelectedCustomer(walkInCustomer);
    }, []);

    const customerOptions = useMemo(() => customers.map(c => ({
        value: c.customer_id,
        label: `${c.first_name} ${c.last_name}`
    })), [customers]);

    const searchResults = searchTerm 
        ? parts.filter(p => p.display_name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 10)
        : [];

    const handleSelectPart = (part) => {
        setCurrentItem({ ...part, sale_price: part.last_sale_price || 0 });
        setIsPriceModalOpen(true);
        setSearchTerm('');
        setHighlightedIndex(-1);
    };

    const handleConfirmAddItem = (confirmedItem) => {
        const existingLine = lines.find(line => line.part_id === confirmedItem.part_id);
        if (existingLine) {
            setLines(lines.map(line =>
                line.part_id === confirmedItem.part_id
                    ? { ...line, quantity: line.quantity + confirmedItem.quantity, sale_price: confirmedItem.sale_price }
                    : line
            ));
        } else {
            setLines([...lines, confirmedItem]);
        }
        setIsPriceModalOpen(false);
        setCurrentItem(null);
        searchInputRef.current?.focus();
    };

    const handleLineChange = (partId, field, value) => {
        const numericValue = parseFloat(value);
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, [field]: isNaN(numericValue) ? '' : numericValue } : line
        ));
    };

    const removeLine = (partId) => {
        setLines(lines.filter(line => line.part_id !== partId));
    };
    
    const handleCancelSale = () => {
        if (lines.length > 0) {
            toast((t) => (
                <div className="flex flex-col items-center">
                    <p className="font-semibold">Cancel Sale?</p>
                    <p className="text-sm text-gray-600 mb-3">All items will be removed.</p>
                    <div className="flex space-x-2">
                        <button onClick={() => { toast.dismiss(t.id); setLines([]); }} className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700">Confirm</button>
                        <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded-md hover:bg-gray-300">Cancel</button>
                    </div>
                </div>
            ));
        }
    };

    const subtotal = lines.reduce((acc, line) => acc + (line.quantity * line.sale_price), 0);
    const tax = subtotal * (settings?.DEFAULT_TAX_RATE || 0);
    const total = subtotal + tax;

    const handleCheckout = async () => {
        if (lines.length === 0) return toast.error("Please add items to the cart.");
        
        const payload = {
            customer_id: selectedCustomer.customer_id,
            employee_id: user.employee_id,
            payment_method: 'Cash',
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price,
            })),
        };
        const promise = axios.post('http://localhost:3001/api/invoices', payload);
        toast.promise(promise, {
            loading: 'Processing sale...',
            success: () => {
                setLines([]);
                setSelectedCustomer(walkInCustomer);
                return 'Sale completed successfully!';
            },
            error: 'Failed to process sale.',
        });
    };

    const handleKeyDown = (e) => {
        if (searchResults.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIndex(prev => (prev + 1) % searchResults.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightedIndex > -1) {
                    handleSelectPart(searchResults[highlightedIndex]);
                }
            }
        }
    };
    
    const handleCustomerSelect = (customerId) => {
        const customer = customers.find(c => c.customer_id === customerId);
        setSelectedCustomer(customer);
        setIsCustomerModalOpen(false);
    };

    return (
        <>
            <div className="flex flex-col md:flex-row h-full gap-6">
                <div className="w-full md:w-2/3">
                    <div className="relative">
                        <Icon path={ICONS.search} className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Scan barcode or search for a part..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg text-lg"
                        />
                         {searchResults.length > 0 && (
                            <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg">
                                {searchResults.map((part, index) => (
                                    <li key={part.part_id} onClick={() => handleSelectPart(part)} className={`px-4 py-3 cursor-pointer ${index === highlightedIndex ? 'bg-blue-100' : 'hover:bg-blue-50'}`}>
                                        {part.display_name}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="w-full md:w-1/3 bg-white rounded-xl border border-gray-200 flex flex-col">
                    <div className="p-4 border-b">
                        <div className="font-semibold mb-2">Customer</div>
                        <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                           <span className="text-sm font-medium">{selectedCustomer?.first_name} {selectedCustomer?.last_name}</span>
                           <button onClick={() => setIsCustomerModalOpen(true)} className="text-sm text-blue-600 hover:text-blue-800 font-semibold">
                               {selectedCustomer?.customer_id === 1 ? 'Select Customer' : 'Change'}
                           </button>
                        </div>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto">
                        {lines.map(line => (
                            <div key={line.part_id} className="flex items-start mb-4">
                                <div className="flex-grow">
                                    <p className="text-sm font-medium">{line.display_name}</p>
                                    <div className="flex items-center mt-1">
                                        <input type="number" value={line.quantity} onChange={(e) => handleLineChange(line.part_id, 'quantity', e.target.value)} className="w-16 px-2 py-1 border rounded-md text-sm" />
                                        <span className="mx-2 text-sm text-gray-500">x</span>
                                        <input type="number" step="0.01" value={line.sale_price} onChange={(e) => handleLineChange(line.part_id, 'sale_price', e.target.value)} className="w-24 px-2 py-1 border rounded-md text-sm" />
                                    </div>
                                </div>
                                <p className="text-sm font-semibold pt-1">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(line.quantity * line.sale_price).toFixed(2)}</p>
                                <button onClick={() => removeLine(line.part_id)} className="ml-3 text-red-500 hover:text-red-700 pt-1"><Icon path={ICONS.close} className="h-5 w-5" /></button>
                            </div>
                        ))}
                        {lines.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No items in cart.</p>}
                    </div>
                    <div className="p-4 border-t space-y-2">
                        <div className="flex justify-between text-sm"><span>Subtotal</span><span>{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{subtotal.toFixed(2)}</span></div>
                        <div className="flex justify-between text-sm"><span>Tax</span><span>{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{tax.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-lg"><span>Total</span><span>{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{total.toFixed(2)}</span></div>
                        <button onClick={handleCheckout} className="w-full mt-4 bg-green-600 text-white py-3 rounded-lg font-semibold text-lg hover:bg-green-700 transition">Checkout</button>
                    </div>
                </div>
            </div>

            <Modal isOpen={isPriceModalOpen} onClose={() => setIsPriceModalOpen(false)} title="Add Item to Sale">
                {currentItem && <PriceQuantityModal item={currentItem} onConfirm={handleConfirmAddItem} onCancel={() => setIsPriceModalOpen(false)} />}
            </Modal>
            <Modal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)} title="Select Customer">
                <Combobox
                    options={customerOptions}
                    value={selectedCustomer?.customer_id}
                    onChange={(value) => handleCustomerSelect(value)}
                    placeholder="Search for a customer..."
                />
            </Modal>
        </>
    );
};

export default POSPage;
