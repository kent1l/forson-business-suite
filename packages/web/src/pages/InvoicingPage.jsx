import { useState, useEffect } from 'react';
import api from '../api';
import { parsePaymentTermsDays } from '../utils/terms';
import { formatPhysicalReceiptNumber } from '../utils/receiptNumberFormatter';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import Modal from '../components/ui/Modal';
import CustomerForm from '../components/forms/CustomerForm';
import PartForm from '../components/forms/PartForm';
import SplitPaymentModal from '../components/ui/SplitPaymentModal';
import { useSettings } from '../contexts/SettingsContext';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import { enrichPartsArray } from '../helpers/applicationCache';

const InvoicingPage = ({ user }) => {
    const { settings } = useSettings();
    const [customers, setCustomers] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [isSplitPaymentModalOpen, setIsSplitPaymentModalOpen] = useState(false);
    const [terms, setTerms] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isNewPartModalOpen, setIsNewPartModalOpen] = useState(false);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);

    const paymentMethodsKey = settings?.PAYMENT_METHODS || '';
    const paymentMethods = paymentMethodsKey ? paymentMethodsKey.split(',') : [];
    const [fetchedTerms, setFetchedTerms] = useState(null);

    const commonTermsFromSettingsKey = settings?.COMMON_PAYMENT_TERMS || '';
    const commonTermsFromSettings = commonTermsFromSettingsKey ? commonTermsFromSettingsKey.split(',').map(t => {
        const m = String(t).match(/(\d{1,4})/);
        if (m) return String(parseInt(m[1], 10));
        if (/due|upon/i.test(t)) return '0';
        return String(t);
    }) : ['0', '7', '15', '30'];

    const commonTerms = fetchedTerms ? fetchedTerms.map(r => String(r.days_to_due)) : commonTermsFromSettings;

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
                const enriched = await enrichPartsArray(response.data || []);
                setSearchResults(enriched);
        } catch (error) {
            console.error('Search error', error);
            toast.error("Search failed.");
            }
        };

        const debounceTimer = setTimeout(fetchSearchResults, 300);
        return () => clearTimeout(debounceTimer);
    }, [searchTerm]);

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                const [customersRes, brandsRes, groupsRes] = await Promise.all([
                    api.get('/customers'),
                    api.get('/brands'),
                    api.get('/groups')
                ]);
                setCustomers(Array.isArray(customersRes.data) ? customersRes.data : []);
                setBrands(Array.isArray(brandsRes.data) ? brandsRes.data : []);
                setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
        } catch (err) {
            console.error('Failed to load initial data', err);
            toast.error("Failed to load initial data.");
            } finally {
                setLoading(false);
            }
        };
        
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (settings) {
            const defaultRaw = settings.DEFAULT_PAYMENT_TERMS || '';
            const m = String(defaultRaw).match(/(\d{1,4})/);
            if (m) {
                setTerms(String(parseInt(m[1], 10)));
            } else if (/due|upon/i.test(defaultRaw)) {
                setTerms('0');
            } else {
                setTerms(String(defaultRaw || ''));
            }

            if (paymentMethodsKey) {
                const methods = paymentMethodsKey.split(',');
                const creditCard = methods.find(m => m.toLowerCase().includes('credit'));
                if (creditCard) {
                    setPaymentMethod(creditCard);
                } else {
                    const first = methods[0];
                    if (first) setPaymentMethod(first);
                }
            }
        }
    }, [settings, paymentMethodsKey]);

    useEffect(() => {
        const fetchTerms = async () => {
            try {
                const res = await api.get('/payment-terms');
                setFetchedTerms(res.data || []);
            } catch (err) {
                // leave fetchedTerms as null to fallback to settings-based list
                console.error('Failed to fetch payment terms from API', err.message);
            }
        };
        fetchTerms();
    }, []);

    const fetchCustomers = async () => {
        const response = await api.get('/customers');
        setCustomers(response.data);
        return response.data;
    };

    const handleNewCustomerSave = async (customerData) => {
        const promise = api.post('/customers', customerData);
        toast.promise(promise, {
            loading: 'Saving customer...',
            success: (response) => {
                const newCustomer = response.data;
                fetchCustomers().then(() => {
                    setSelectedCustomer(newCustomer.customer_id);
                });
                setIsCustomerModalOpen(false);
                return 'Customer saved successfully!';
            },
            error: 'Failed to save customer.',
        });
    };

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
    };

    const handleSaveNewPart = (partData) => {
        const payload = { ...partData, created_by: user.employee_id, tags: ['old_new'] };
        const promise = api.post('/parts', payload);

        toast.promise(promise, {
            loading: 'Saving new part...',
            success: (response) => {
                const newPart = response.data;
                setIsNewPartModalOpen(false);
                addPartToLines({ ...newPart, quantity: 1, sale_price: newPart.last_sale_price || 0 });
                
                return 'Part added and added to cart!';
            },
            error: 'Failed to save part.'
        });
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

        // Check if split payments are enabled
        const splitPaymentsEnabled = settings?.ENABLE_SPLIT_PAYMENTS === 'true';

        if (splitPaymentsEnabled) {
            // Use split payment modal for payment processing
            setIsSplitPaymentModalOpen(true);
            return;
        }

        // Legacy single payment method flow
        if (!paymentMethod) {
            toast.error('Please select a payment method.');
            return;
        }

        // Set amount_paid based on payment method
        const amount_paid = paymentMethod.toLowerCase() === 'cash' ? subtotal : 0;

        const payload = {
            customer_id: selectedCustomer,
            employee_id: user.employee_id,
            payment_method: paymentMethod,
            amount_paid: amount_paid,
            terms: terms,
            payment_terms_days: parsePaymentTermsDays(terms),
            physical_receipt_no: formatPhysicalReceiptNumber(physicalReceiptNo) || null,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price,
            })),
        };

        const promise = api.post('/invoices', payload);

        toast.promise(promise, {
            loading: 'Posting invoice...',
            success: () => {
                setLines([]);
                setSelectedCustomer('');
                setTerms(settings.DEFAULT_PAYMENT_TERMS || '');
                return 'Invoice created successfully!';
            },
            error: (err) => {
                if (err?.response?.status === 409) {
                    return err.response.data?.message || 'Physical Receipt No already exists.';
                }
                return 'Failed to create invoice.';
            },
        });
    };

    // Handle split payment confirmation for invoicing
    const handleConfirmSplitPayment = async (payments, physicalReceiptNo, { employeeId } = {}) => {
        try {
            // First create the invoice without payments
            const invoicePayload = {
                customer_id: selectedCustomer,
                employee_id: employeeId || user.employee_id,
                terms: terms,
                payment_terms_days: parsePaymentTermsDays(terms),
                physical_receipt_no: formatPhysicalReceiptNumber(physicalReceiptNo),
                lines: lines.map(line => ({
                    part_id: line.part_id,
                    quantity: line.quantity,
                    sale_price: line.sale_price,
                })),
            };

            const invoiceResponse = await api.post('/invoices', invoicePayload);
            const invoiceId = invoiceResponse.data.invoice_id;
            const returnedPhysicalReceiptNo = invoiceResponse.data.physical_receipt_no;

            // Check if physical receipt number was auto-incremented
            if (returnedPhysicalReceiptNo && returnedPhysicalReceiptNo !== formatPhysicalReceiptNumber(physicalReceiptNo)) {
                toast.success(`Invoice created! Physical receipt number was auto-incremented to: ${returnedPhysicalReceiptNo}`);
            }

            // Then add payments to the invoice
            await api.post(`/invoices/${invoiceId}/payments`, {
                payments,
                physical_receipt_no: returnedPhysicalReceiptNo || formatPhysicalReceiptNumber(physicalReceiptNo),
                employee_id: employeeId || user.employee_id
            });

            // Success - reset form
            setLines([]);
            setSelectedCustomer('');
            setTerms(settings.DEFAULT_PAYMENT_TERMS || '');
            setIsSplitPaymentModalOpen(false);

            toast.success('Invoice created successfully!');

        } catch (err) {
            console.error('Split payment error:', err);
            const backendMessage = err?.response?.data?.message || err?.response?.data?.error || err?.message;
            if (err?.response?.status === 409) {
                throw new Error(backendMessage || 'Physical Receipt No already exists.');
            }
            // Surface backend validation errors when present
            if (err?.response?.status === 400 && backendMessage) {
                toast.error(backendMessage);
                throw new Error(backendMessage);
            }
            throw new Error('Failed to create invoice.');
        }
    };

    const subtotal = lines.reduce((acc, line) => {
        const quantity = parseFloat(line.quantity) || 0;
        const salePrice = parseFloat(line.sale_price) || 0;
        return acc + (quantity * salePrice);
    }, 0);

    if (loading) return <p>Loading data...</p>;

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">New Invoice</h1>
                    <div className="flex items-center space-x-2">
                        <button onClick={handlePostInvoice} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition shadow-sm flex items-center">
                            <Icon path={ICONS.check} className="h-5 w-5 mr-2" />
                            Post Invoice
                        </button>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm space-y-8">
                    {/* Customer and Payment Section */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
                            <div className="flex items-center space-x-2">
                                <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)} className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
                                    <option value="">Select a Customer</option>
                                    {customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>)}
                                </select>
                                <button onClick={() => setIsCustomerModalOpen(true)} className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition">
                                    <Icon path={ICONS.plus} className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                        {settings?.ENABLE_SPLIT_PAYMENTS === 'true' ? (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Payment</label>
                                <p className="text-sm text-gray-600 pt-2">Payment details will be handled at checkout.</p>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
                                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
                                    {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Physical Receipt No.</label>
                            <input
                                type="text"
                                value={physicalReceiptNo}
                                onChange={e => setPhysicalReceiptNo(e.target.value)}
                                className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder={settings?.RECEIPT_NO_HELP_TEXT || 'Enter receipt number'}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Terms</label>
                            <div className="flex items-center space-x-3">
                                <select
                                    value={commonTerms.includes(terms) ? terms : 'custom'}
                                    onChange={e => setTerms(e.target.value)}
                                    className="px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                >
                                    {commonTerms.map(ct => <option key={ct} value={ct}>{ct === '0' ? 'Due on Receipt' : `${ct} Days`}</option>)}
                                    <option value="custom">Custom...</option>
                                </select>
                                <input
                                    type="text"
                                    value={terms}
                                    onChange={e => setTerms(e.target.value)}
                                    onFocus={e => e.target.select()}
                                    className="flex-1 px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="e.g., 30"
                                />
                            </div>
                        </div>
                    </div>
                    
                    {/* Add Part Section */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Add Items</label>
                        <div className="flex items-center space-x-2">
                            <div className="relative flex-grow">
                                <SearchBar
                                    value={searchTerm}
                                    onChange={setSearchTerm}
                                    onClear={() => setSearchTerm('')}
                                    placeholder="Search by part name, SKU, or application..."
                                />
                            </div>
                            <button onClick={() => setIsNewPartModalOpen(true)} className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg font-semibold hover:bg-indigo-100 transition whitespace-nowrap flex items-center">
                                <Icon path={ICONS.plus} className="h-5 w-5 mr-2" />
                                New Part
                            </button>
                        </div>
                        {searchResults.length > 0 && (
                            <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg search-results max-h-60 overflow-y-auto">
                                {searchResults.map(part => (
                                    <li key={part.part_id} onClick={() => addPartToLines(part)} className="px-4 py-3 hover:bg-indigo-50 cursor-pointer border-b last:border-b-0">
                                        <div className="flex items-baseline justify-between">
                                            <div className="flex items-baseline space-x-2 flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-800 truncate">{part.display_name}</div>
                                                {part.applications && <div className="text-xs text-gray-500 truncate">{formatApplicationText(part.applications, { style: 'searchSuggestion' })}</div>}
                                            </div>
                                            <div className="text-sm font-semibold text-gray-700 ml-4">
                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{part.last_sale_price ? Number(part.last_sale_price).toFixed(2) : '0.00'}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Invoice Lines Table */}
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-gray-600">Item</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 w-32 text-center">Quantity</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 w-40 text-right">Sale Price</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 w-40 text-right">Line Total</th>
                                    <th className="p-4 text-sm font-semibold text-gray-600 w-16 text-center"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.length > 0 ? lines.map(line => (
                                    <tr key={line.part_id} className="border-b last:border-b-0 hover:bg-gray-50">
                                        <td className="p-4 text-sm font-medium text-gray-800">{line.display_name}</td>
                                        <td className="p-4"><input type="number" value={line.quantity} onChange={e => handleLineChange(line.part_id, 'quantity', e.target.value)} onFocus={e => e.target.select()} className="w-full p-2 border-gray-300 rounded-md text-center" /></td>
                                        <td className="p-4"><input type="number" value={line.sale_price} onChange={e => handleLineChange(line.part_id, 'sale_price', e.target.value)} onFocus={e => e.target.select()} className="w-full p-2 border-gray-300 rounded-md text-right" /></td>
                                        <td className="p-4 text-sm font-medium text-gray-800 text-right">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(line.quantity * line.sale_price).toFixed(2)}</td>
                                        <td className="p-4 text-center"><button onClick={() => removeLine(line.part_id)} className="text-gray-400 hover:text-red-600 transition-colors"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="5" className="text-center py-12 text-gray-500">
                                            <Icon path={ICONS.inbox} className="h-12 w-12 mx-auto text-gray-300 mb-2" />
                                            No items added yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Totals Section */}
                    <div className="flex justify-end items-center pt-6 border-t">
                        <div className="text-right space-y-2">
                            <p className="text-xl font-semibold text-gray-800">
                                <span className="font-medium text-gray-600">Subtotal:</span> {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{subtotal.toFixed(2)}
                            </p>
                            <p className="text-sm text-gray-500">+ Tax (calculated upon posting)</p>
                        </div>
                    </div>
                </div>
            </div>
            <Modal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)} title="Add New Customer">
                <CustomerForm onSave={handleNewCustomerSave} onCancel={() => setIsCustomerModalOpen(false)} />
            </Modal>
            <Modal isOpen={isNewPartModalOpen} onClose={() => setIsNewPartModalOpen(false)} title="Add New Part">
                <PartForm
                    brands={brands}
                    groups={groups}
                    onSave={handleSaveNewPart}
                    onCancel={() => setIsNewPartModalOpen(false)}
                />
            </Modal>
            {settings?.ENABLE_SPLIT_PAYMENTS === 'true' && (
                <SplitPaymentModal
                    isOpen={isSplitPaymentModalOpen}
                    onClose={() => setIsSplitPaymentModalOpen(false)}
                    totalDue={subtotal || 0}
                    onConfirm={handleConfirmSplitPayment}
                    physicalReceiptNo={physicalReceiptNo}
                    onPhysicalReceiptChange={setPhysicalReceiptNo}
                    requirePhysicalReceipt={true}
                    employeeId={user?.employee_id}
                />
            )}
        </div>
    );
};

export default InvoicingPage;