import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import MathExpressionInput from '../components/ui/MathExpressionInput';
import { formatPhysicalReceiptNumber } from '../utils/receiptNumberFormatter';

export default function CashierApprovalDesk({ onNavigate }) {
    const [activeFilter, setActiveFilter] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'REJECTED'
    const [searchQuery, setSearchQuery] = useState('');
    const [sales, setSales] = useState([]);
    const [selectedSale, setSelectedSale] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [actioning, setActioning] = useState(false);

    // Customers list and searchable dropdown state
    const [customers, setCustomers] = useState([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);

    // Modal state for details review
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);
    const [editablePrn, setEditablePrn] = useState('');
    const [editableTendered, setEditableTendered] = useState('');

    // Rejection sub-modal state
    const [isRejectOpen, setIsRejectOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState('Pricing mismatch');
    const [rejectNotes, setRejectNotes] = useState('');

    const fetchSales = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/sales/staging?status=${activeFilter}`);
            setSales(data || []);
        } catch (error) {
            toast.error('Failed to load staging queue.');
        } finally {
            setLoading(false);
        }
    };

    const fetchCustomers = async () => {
        try {
            const { data } = await api.get('/customers');
            setCustomers(data || []);
        } catch (error) {
            console.error('Failed to fetch customers', error);
        }
    };

    useEffect(() => {
        fetchSales();
        fetchCustomers();
    }, [activeFilter]);

    const handleRowClick = async (sale) => {
        setDetailLoading(true);
        setIsDetailsOpen(true);
        try {
            const { data } = await api.get(`/sales/staging/${sale.id}`);
            setSelectedSale(data);
            setEditablePrn(data.physical_receipt_no || '');
            setEditableTendered(data.tendered_amount || '');
            setSelectedCustomerId(data.customer_id);

            // Find current customer details to pre-populate search input
            const currentCust = customers.find(c => c.customer_id === data.customer_id);
            setCustomerSearch(currentCust ? `${currentCust.first_name} ${currentCust.last_name || ''}`.trim() : data.customer_name || '');
        } catch (error) {
            toast.error('Failed to load transaction details.');
            setIsDetailsOpen(false);
        } finally {
            setDetailLoading(false);
        }
    };

    const handleApprove = async () => {
        if (!selectedSale) return;
        setActioning(true);

        const formattedPrn = formatPhysicalReceiptNumber(editablePrn);

        try {
            await api.post(`/sales/staging/${selectedSale.id}/approve-post`, {
                physical_receipt_no: formattedPrn,
                tendered_amount: editableTendered !== '' && editableTendered !== null ? (typeof editableTendered === 'number' ? editableTendered : Number(editableTendered)) : null,
                customer_id: selectedCustomerId
            });
            toast.success(`Transaction #${selectedSale.id} approved & posted!`);
            setIsDetailsOpen(false);
            fetchSales();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Approval failed.');
        } finally {
            setActioning(false);
        }
    };

    const handleEditConvert = () => {
        if (!selectedSale) return;
        setIsDetailsOpen(false);

        // Map items for InvoicingPage pageState
        const pageStatePayload = {
            lines: selectedSale.items.map(item => ({
                part_id: item.part_id,
                quantity: Number(item.qty),
                sale_price: Number(item.sale_price),
                discount_amount: Number(item.discount_amount) || 0,
                tax_rate_id: selectedSale.tax_rate_id || null,
                detail: item.name,
                display_name: item.name
            })),
            selectedCustomer: selectedCustomerId, // Pass updated customer ID
            staged_sale_id: selectedSale.id // link staging record to resolve on post
        };

        // Redirect seamlessly to Invoicing page
        onNavigate('invoicing', pageStatePayload);
    };

    const handleRejectSubmit = async () => {
        if (!selectedSale) return;
        setActioning(true);
        try {
            await api.post(`/sales/staging/${selectedSale.id}/reject`, {
                reason: rejectReason,
                notes: rejectNotes
            });
            toast.success(`Transaction #${selectedSale.id} rejected.`);
            setIsRejectOpen(false);
            setIsDetailsOpen(false);
            setRejectNotes('');
            fetchSales();
        } catch (err) {
            toast.error('Rejection failed.');
        } finally {
            setActioning(false);
        }
    };

    const filteredSales = sales.filter(sale =>
        sale.id.toString().includes(searchQuery) ||
        sale.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sale.items_summary?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const computedChange = () => {
        if (!selectedSale) return 0;
        const total = parseFloat(selectedSale.total_amount) || 0;
        const tendered = typeof editableTendered === 'number' ? editableTendered : (parseFloat(editableTendered) || 0);
        return tendered > total ? tendered - total : 0;
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Cashier Staging Approval Desk</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">Approve, edit, or reject transactions staged from POS Mobile.</p>
                </div>

                <div className="relative max-w-xs w-full">
                    <input
                        type="text"
                        placeholder="Search staging ID, customer, or items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <span className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </span>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg self-start border border-slate-200 dark:border-slate-700">
                {[
                    { key: 'PENDING', label: 'Pending Queue', color: 'bg-amber-500' },
                    { key: 'APPROVED', label: 'Approved & Posted', color: 'bg-emerald-500' },
                    { key: 'REJECTED', label: 'Rejected', color: 'bg-rose-500' }
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveFilter(tab.key)}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${
                            activeFilter === tab.key
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full ${tab.color}`} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table Listing */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Queue List</span>
                    <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 py-0.5 rounded-full font-semibold">{filteredSales.length} items</span>
                </div>

                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="flex justify-center items-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
                        </div>
                    ) : filteredSales.length === 0 ? (
                        <div className="flex flex-col justify-center items-center py-20 text-slate-400 dark:text-slate-500">
                            <Icon path={ICONS.pos} className="w-12 h-12 stroke-current mb-2 opacity-50" />
                            <span className="text-sm font-medium">Staging queue is empty</span>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm divide-y divide-slate-200 dark:divide-slate-700">
                            <thead className="bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-300 font-bold">
                                <tr>
                                    <th className="px-6 py-3">Staging ID</th>
                                    <th className="px-6 py-3">Date Staged</th>
                                    <th className="px-6 py-3">Staged By</th>
                                    <th className="px-6 py-3">Customer</th>
                                    <th className="px-6 py-3">Receipt No (PRN)</th>
                                    <th className="px-6 py-3">Payment Method</th>
                                    <th className="px-6 py-3 text-right">Total Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                {filteredSales.map(sale => (
                                    <tr
                                        key={sale.id}
                                        onClick={() => handleRowClick(sale)}
                                        className="hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer transition-colors duration-150 text-slate-800 dark:text-slate-200"
                                    >
                                        <td className="px-6 py-4 font-mono font-semibold text-slate-900 dark:text-slate-100">
                                            STG-{sale.id}
                                            {sale.source === 'Mobile-Offline' && (
                                                <span
                                                    className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 align-middle"
                                                    title="Rung up offline on a phone and synced later"
                                                >
                                                    Offline
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400">
                                            {new Date(sale.captured_at || sale.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300 text-sm">{sale.cashier_name}</td>
                                        <td className="px-6 py-4 text-slate-800 dark:text-slate-100 font-medium">{sale.customer_name}</td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-400">{sale.physical_receipt_no || '-'}</td>
                                        <td className="px-6 py-4"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{sale.payment_method_name}</span></td>
                                        <td className="px-6 py-4 text-right font-bold text-slate-900 dark:text-slate-50">{sale.total_formatted}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Details inspection modal */}
            {isDetailsOpen && (
                <Modal
                    isOpen={isDetailsOpen}
                    onClose={() => setIsDetailsOpen(false)}
                    title={selectedSale ? `Review Staged Sale STG-${selectedSale.id}` : 'Reviewing Transaction...'}
                    maxWidth="max-w-2xl"
                >
                    {detailLoading ? (
                        <div className="flex justify-center items-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
                        </div>
                    ) : selectedSale && (
                        <div className="space-y-6">
                            {selectedSale.source === 'Mobile-Offline' && (
                                <div className="flex gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-sm text-amber-800 dark:text-amber-300">
                                    <span aria-hidden className="text-lg leading-none">⚠</span>
                                    <div>
                                        <p className="font-semibold">Rung up offline</p>
                                        <p className="text-amber-700 dark:text-amber-300/80">
                                            This sale was taken on a phone at{' '}
                                            {new Date(selectedSale.captured_at).toLocaleString('en-PH')} and only
                                            reached the server later. The invoice will be dated to when it was rung
                                            up, and stock may have been sold since — check the quantities below.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-sm">
                                <div>
                                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold mb-1">Staged By</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-100">{selectedSale.cashier_name}</span>
                                </div>
                                <div className="relative">
                                    <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-bold mb-1">Customer</span>
                                    <input
                                        type="text"
                                        value={customerSearch}
                                        onChange={(e) => {
                                            setCustomerSearch(e.target.value);
                                            setCustomerDropdownOpen(true);
                                        }}
                                        onFocus={() => setCustomerDropdownOpen(true)}
                                        onBlur={() => setTimeout(() => setCustomerDropdownOpen(false), 200)}
                                        className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none bg-white dark:bg-slate-800 font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                        placeholder="Search customer name..."
                                    />
                                    {customerDropdownOpen && (
                                        <div className="absolute z-50 w-full mt-1 max-h-40 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                                            {customers
                                                .filter(c => 
                                                    `${c.first_name} ${c.last_name || ''}`.toLowerCase().includes(customerSearch.toLowerCase())
                                                )
                                                .map(c => (
                                                    <button
                                                        key={c.customer_id}
                                                        type="button"
                                                        onClick={() => {
                                                            setSelectedCustomerId(c.customer_id);
                                                            setCustomerSearch(`${c.first_name} ${c.last_name || ''}`.trim());
                                                            setCustomerDropdownOpen(false);
                                                        }}
                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-xs text-slate-700 dark:text-slate-200 font-semibold border-b border-slate-100 dark:border-slate-700/60 last:border-0"
                                                    >
                                                        {c.first_name} {c.last_name}
                                                    </button>
                                                ))
                                            }
                                        </div>
                                    )}
                                </div>
                                <div className="mt-2">
                                    <label className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold mb-1">Physical Receipt Number (PRN)
                                        <InfoTip label="Physical Receipt Number (PRN)">
                                            The physical receipt number written or printed at the point of sale — double-check it matches before approving, since approving posts the transaction permanently.
                                        </InfoTip>
                                    </label>
                                    <input
                                        type="text"
                                        value={editablePrn}
                                        onChange={(e) => setEditablePrn(formatPhysicalReceiptNumber(e.target.value) || '')}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                        placeholder="e.g. SI-1234, ABC/5678"
                                    />
                                </div>
                                <div className="mt-2">
                                    <label className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold mb-1">Tendered Amount
                                        <InfoTip label="Tendered Amount" align="right">
                                            Change is calculated automatically as Tendered Amount minus the Grand Total, and only shown when positive.
                                        </InfoTip>
                                    </label>
                                    <MathExpressionInput
                                        precision={2}
                                        value={editableTendered}
                                        onChange={(val) => setEditableTendered(val)}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                        placeholder="0.00"
                                    />
                                    {computedChange() > 0 && (
                                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">Change: ₱{computedChange().toFixed(2)}</p>
                                    )}
                                </div>
                            </div>

                            <div>
                                <span className="block text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Item lines</span>
                                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-sm divide-y divide-slate-200 dark:divide-slate-700">
                                        <thead className="bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-300 font-bold">
                                            <tr>
                                                <th className="px-4 py-2">Item Name</th>
                                                <th className="px-4 py-2">SKU</th>
                                                <th className="px-4 py-2 text-right">Qty</th>
                                                <th className="px-4 py-2 text-right">Price</th>
                                                <th className="px-4 py-2 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                            {selectedSale.items?.map((item, idx) => {
                                                const onHand = Number(item.stock_on_hand);
                                                const short = Number.isFinite(onHand) && onHand < Number(item.qty);
                                                return (
                                                    <tr key={idx} className={short ? 'bg-amber-50 dark:bg-amber-950/40' : undefined}>
                                                        <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                                                            {item.name}
                                                            {short && (
                                                                <span className="block text-xs font-normal text-amber-700 dark:text-amber-300">
                                                                    Only {onHand} on hand — this sale is for {item.qty}.
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 font-mono text-xs">{item.sku}</td>
                                                        <td className={`px-4 py-2.5 text-right font-medium ${short ? 'text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>{item.qty}</td>
                                                        <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">{item.price_formatted}</td>
                                                        <td className="px-4 py-2.5 text-right font-bold text-slate-900 dark:text-slate-50">{item.total_formatted}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-700">
                                <div className="w-64 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                                    <div className="flex justify-between"><span>Subtotal (Excl. VAT)</span><span className="font-semibold text-slate-800 dark:text-slate-100">{selectedSale.subtotal_formatted}</span></div>
                                    <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500"><span>VAT Amount ({selectedSale.tax_rate_name})</span><span>{selectedSale.tax_amount_formatted}</span></div>
                                    <div className="flex justify-between font-bold text-slate-900 dark:text-slate-50 border-t border-slate-200 dark:border-slate-700 pt-2 text-base"><span>Grand Total</span><span>{selectedSale.total_formatted}</span></div>
                                </div>
                            </div>

                            {activeFilter === 'PENDING' && (
                                <div className="flex justify-between items-center pt-6 border-t border-slate-100 dark:border-slate-700">
                                    <button
                                        onClick={handleEditConvert}
                                        className="px-5 py-2 border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        Edit / Convert to Invoice
                                    </button>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setIsRejectOpen(true)}
                                            disabled={actioning}
                                            className="px-5 py-2 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-bold rounded-lg transition-colors"
                                        >
                                            Reject Transaction
                                        </button>
                                        <button
                                            onClick={handleApprove}
                                            disabled={actioning}
                                            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm hover:shadow transition-all duration-200"
                                        >
                                            Approve & Post
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </Modal>
            )}

            {/* Rejection Modal */}
            {isRejectOpen && (
                <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl w-full max-w-md overflow-hidden p-6 space-y-4">
                        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Confirm Rejection</h2>
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5">Reason Category</label>
                            <select
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                                <option value="Pricing mismatch">Pricing mismatch / Incorrect discounts</option>
                                <option value="Customer signature missing">Customer signature missing</option>
                                <option value="Incorrect tax category">Incorrect tax category applied</option>
                                <option value="Invalid payment authorization">Invalid payment authorization</option>
                                <option value="Other">Other (Explain below)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5">Internal Notes</label>
                            <textarea
                                rows={3}
                                value={rejectNotes}
                                onChange={(e) => setRejectNotes(e.target.value)}
                                placeholder="Notes visible to the cashier..."
                                className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-700">
                            <button onClick={() => setIsRejectOpen(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 text-xs font-bold transition-colors">Cancel</button>
                            <button onClick={handleRejectSubmit} className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors">Reject</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
