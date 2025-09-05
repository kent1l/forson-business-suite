import { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import useTypeahead from '../hooks/useTypeahead';
import { useSettings } from '../contexts/SettingsContext';
import Modal from '../components/ui/Modal';
import CustomerForm from '../components/forms/CustomerForm';
import Combobox from '../components/ui/Combobox';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import { enrichPartsArray } from '../helpers/applicationCache';
import PaymentModal from '../components/ui/PaymentModal';
import PriceQuantityModal from '../components/ui/PriceQuantityModal';
import Receipt from '../components/ui/Receipt';
import PartForm from '../components/forms/PartForm';

const POSPage = ({ user, lines, setLines }) => {
    const { settings } = useSettings();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]); // State for search results
    const [customers, setCustomers] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [taxRates, setTaxRates] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isNewPartModalOpen, setIsNewPartModalOpen] = useState(false);
    const [currentItem, setCurrentItem] = useState(null);
    const [lastSale, setLastSale] = useState(null);
    const searchInputRef = useRef(null);
    const { getInputProps, getItemProps, reset } = useTypeahead({ items: searchResults, onSelect: (item) => { handleSelectPart(item); }, inputId: 'pos-search-input', listboxId: 'pos-search-results' });

    // Debounced search effect
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
                // Debug: log raw hits for applications field
                console.debug('[POS] raw search results', response.data.map(r => ({part_id: r.part_id, apps: r.applications})));
                // Enrich applications (convert id arrays to objects) so the application text helper shows readable text
                const enriched = await enrichPartsArray(response.data || []);
                console.debug('[POS] enriched results', enriched.map(r => ({part_id: r.part_id, apps: r.applications})));
                setSearchResults(enriched);
            } catch (error) {
                console.error("Search failed:", error);
                toast.error("Search failed.");
            }
        };

        const debounceTimer = setTimeout(() => {
            fetchSearchResults();
        }, 300); // 300ms delay

        return () => clearTimeout(debounceTimer);
    }, [searchTerm]);


    const fetchCustomers = async () => {
        try {
            const customersRes = await api.get('/customers?status=active');
            setCustomers(customersRes.data);
            return customersRes.data;
        } catch (err) {
            console.error('fetchCustomers error', err);
            toast.error("Could not load customer data.");
        }
    };

    useEffect(() => {
        (async () => {
            try {
                const [brandsRes, groupsRes, taxRatesRes] = await Promise.all([
                    api.get('/brands'),
                    api.get('/groups'),
                    api.get('/tax-rates')
                ]);
                setBrands(brandsRes.data);
                setGroups(groupsRes.data);
                setTaxRates(taxRatesRes.data);
                
                const customersData = await fetchCustomers();
                if (customersData) {
                    const walkIn = customersData.find(c => c.first_name.toLowerCase() === 'walk-in');
                    setSelectedCustomer(walkIn || null);
                }
            } catch (err) {
                console.error('fetchInitialData error', err);
                toast.error("Could not load initial data.");
            }
        })();
    }, []);

    const customerOptions = useMemo(() => customers.map(c => ({
        value: c.customer_id,
        label: `${c.first_name} ${c.last_name || ''}`.trim()
    })), [customers]);

    const handleSelectPart = (part) => {
        setCurrentItem({ ...part, sale_price: part.last_sale_price || 0 });
        setIsPriceModalOpen(true);
        setSearchTerm('');
        setSearchResults([]);
    reset();
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

    const handleSaveNewPart = (partData) => {
        const payload = { ...partData, created_by: user.employee_id };
        const promise = api.post('/parts', payload);

        toast.promise(promise, {
            loading: 'Saving new part...',
            success: (response) => {
                const newPart = response.data;
                setIsNewPartModalOpen(false);
                handleConfirmAddItem({ ...newPart, quantity: 1, sale_price: newPart.last_sale_price || 0 });
                
                return 'Part added and added to cart!';
            },
            error: 'Failed to save part.'
        });
    };

    // Provide a callable version used by child components when brands/groups change
    const fetchInitialData = async () => {
        try {
            const [brandsRes, groupsRes, taxRatesRes] = await Promise.all([
                api.get('/brands'),
                api.get('/groups'),
                api.get('/tax-rates')
            ]);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
            setTaxRates(taxRatesRes.data);

            const customersData = await fetchCustomers();
            if (customersData) {
                const walkIn = customersData.find(c => c.first_name.toLowerCase() === 'walk-in');
                setSelectedCustomer(walkIn || null);
            }
        } catch (err) {
            console.error('fetchInitialData error', err);
            toast.error("Could not load initial data.");
        }
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
    
    const { subtotal, tax, total } = useMemo(() => {
        const taxRatesMap = new Map(taxRates.map(rate => [rate.tax_rate_id, parseFloat(rate.rate_percentage)]));
        const defaultTaxRate = taxRates.find(r => r.is_default)?.rate_percentage || 0;

        let calculatedSubtotal = 0;
        let calculatedTax = 0;

        lines.forEach(line => {
            const lineSubtotal = line.quantity * line.sale_price;
            calculatedSubtotal += lineSubtotal;

            const ratePercentage = taxRatesMap.get(line.tax_rate_id) ?? defaultTaxRate;

            if (line.is_tax_inclusive_price) {
                const taxAmount = lineSubtotal - (lineSubtotal / (1 + ratePercentage));
                calculatedTax += taxAmount;
            } else {
                calculatedTax += lineSubtotal * ratePercentage;
            }
        });

        return {
            subtotal: calculatedSubtotal,
            tax: calculatedTax,
            total: calculatedSubtotal + calculatedTax,
        };
    }, [lines, taxRates]);

    const handleCheckout = () => {
        if (lines.length === 0) return toast.error("Please add items to the cart.");
        if (!selectedCustomer) return toast.error("Please select a customer.");
        setIsPaymentModalOpen(true);
    };

    const handleConfirmPayment = (paymentMethod, amountPaid, tenderedAmount, physicalReceiptNo) => {
        // Enforce full payment on POS: always send amount_paid equal to the final total.
        console.debug(`POS payment: method=${paymentMethod}, tendered=${tenderedAmount}, amountPaid=${amountPaid}, enforced=${total}`);
        const payload = {
            customer_id: selectedCustomer.customer_id,
            employee_id: user.employee_id,
            payment_method: paymentMethod,
            amount_paid: Number(total) || 0,
            tendered_amount: typeof tenderedAmount !== 'undefined' && tenderedAmount !== null ? Number(tenderedAmount) : null,
            physical_receipt_no: (physicalReceiptNo || '').trim() || null,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price,
            })),
        };
        const promise = api.post('/invoices', payload);
        toast.promise(promise, {
            loading: 'Processing sale...',
            success: (response) => {
                const newInvoiceNumber = response.data.invoice_number;
                const saleDataForReceipt = { lines, total, subtotal, tax, invoice_number: newInvoiceNumber, physical_receipt_no: (physicalReceiptNo || '').trim() || null };
                setLastSale(saleDataForReceipt);
                setLines([]);
                const walkIn = customers.find(c => c.first_name.toLowerCase() === 'walk-in');
                setSelectedCustomer(walkIn || null);
                setIsPaymentModalOpen(false);
                
                toast.success(
                    (t) => (
                        <div className="flex items-center">
                            <span className="mr-4">Sale completed!</span>
                            <button
                                onClick={() => {
                                    toast.dismiss(t.id);
                                    handlePrintReceipt(saleDataForReceipt);
                                }}
                                className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                            >
                                Print Receipt
                            </button>
                        </div>
                    ), { duration: 10000 }
                );
                return 'Sale completed successfully!';
            },
            error: (err) => {
                if (err?.response?.status === 409) {
                    return err.response.data?.message || 'Physical Receipt No already exists.';
                }
                return 'Failed to process sale.';
            },
        });
    };
    
    const handlePrintReceipt = (saleData) => {
        const printWindow = window.open('/print.html', '_blank', 'width=300,height=500');
        printWindow.onload = () => {
            const root = ReactDOM.createRoot(printWindow.document.getElementById('receipt-root'));
            root.render(<Receipt saleData={saleData} settings={settings} />);
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 500);
        };
    };

    // useTypeahead handles keyboard navigation and selection for the search input
    
    const handleCustomerSelect = (customerId) => {
        const customer = customers.find(c => c.customer_id === customerId);
        setSelectedCustomer(customer);
        setIsCustomerModalOpen(false);
    };

    // Application text formatting is handled by the helper

    const handleSaveNewCustomer = (customerData) => {
        const promise = api.post('/customers', customerData);
        toast.promise(promise, {
            loading: 'Saving customer...',
            success: async (response) => {
                const newCustomer = response.data;
                await fetchCustomers();
                setSelectedCustomer(newCustomer);
                setIsNewCustomerModalOpen(false);
                return 'New customer added successfully!';
            },
            error: 'Failed to save customer.',
        });
    };

    return (
        <>
            <div className="flex flex-col md:flex-row h-full gap-6">
                <div className="w-full md:w-2/3">
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <SearchBar
                                {...getInputProps()}
                                value={searchTerm}
                                onChange={setSearchTerm}
                                onClear={() => { setSearchTerm(''); setSearchResults([]); reset(); }}
                                placeholder="Scan barcode or search for a part..."
                                disabled={false}
                                className=""
                                ref={searchInputRef}
                            />
                            {searchResults.length > 0 && (
                                <ul id="pos-search-results" className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg search-results" role="listbox">
                                    {searchResults.map((part, index) => {
                                        const itemProps = getItemProps(index);
                                        return (
                                                <li key={part.part_id} {...itemProps} className={`px-4 py-3 cursor-pointer ${itemProps['aria-selected'] ? 'bg-blue-100' : 'hover:bg-blue-50'}`}>
                                                    <div className="flex items-baseline space-x-2">
                                                        <div className="text-sm font-medium text-gray-800 truncate">{part.display_name}</div>
                                                        {part.applications && <div className="text-xs text-gray-500 truncate">{formatApplicationText(part.applications, { truncate: true, maxLength: 80 })}</div>}
                                                    </div>
                                                </li>
                                            );
                                    })}
                                </ul>
                            )}
                        </div>
                        <button onClick={() => setIsNewPartModalOpen(true)} className="bg-blue-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-blue-700 transition whitespace-nowrap">
                           New Part
                        </button>
                    </div>
                </div>

                <div className="w-full md:w-1/3 bg-white rounded-xl border border-gray-200 flex flex-col">
                    <div className="p-4 border-b">
                        <div className="font-semibold mb-2">Customer</div>
                        <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                           <span className="text-sm font-medium">{selectedCustomer?.first_name} {selectedCustomer?.last_name}</span>
                           <button onClick={() => setIsCustomerModalOpen(true)} className="text-sm text-blue-600 hover:text-blue-800 font-semibold">
                               Change
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

            <Modal isOpen={isNewPartModalOpen} onClose={() => setIsNewPartModalOpen(false)} title="Add New Part">
                <PartForm
                    brands={brands}
                    groups={groups}
                    onSave={handleSaveNewPart}
                    onCancel={() => setIsNewPartModalOpen(false)}
                    onBrandGroupAdded={fetchInitialData}
                />
            </Modal>

            <Modal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)} title="Select Customer">
                <div className="space-y-4">
                    <Combobox
                        options={customerOptions}
                        value={selectedCustomer?.customer_id}
                        onChange={(value) => handleCustomerSelect(value)}
                        placeholder="Search for a customer..."
                    />
                    <button
                        onClick={() => {
                            setIsCustomerModalOpen(false);
                            setIsNewCustomerModalOpen(true);
                        }}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
                    >
                        Add New Customer
                    </button>
                </div>
            </Modal>

            <Modal isOpen={isNewCustomerModalOpen} onClose={() => setIsNewCustomerModalOpen(false)} title="Add New Customer">
                <CustomerForm
                    onSave={handleSaveNewCustomer}
                    onCancel={() => setIsNewCustomerModalOpen(false)}
                />
            </Modal>

            <PaymentModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                total={total}
                onConfirmPayment={handleConfirmPayment}
            />
            <div className="hidden">
                <Receipt saleData={lastSale} settings={settings} />
            </div>
        </>
    );
};

export default POSPage;