import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import { formatPhysicalReceiptNumber } from '../utils/receiptNumberFormatter';

export default function CashierApprovalDesk({ onNavigate }) {
    const [activeFilter, setActiveFilter] = useState('PENDING'); // 'PENDING' | 'APPROVED' | 'REJECTED'
    const [searchQuery, setSearchQuery] = useState('');
    const [sales, setSales] = useState([]);
    const [selectedSale, setSelectedSale] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [actioning, setActioning] = useState(false);

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

    useEffect(() => {
        fetchSales();
    }, [activeFilter]);

    const handleRowClick = async (sale) => {
        setDetailLoading(true);
        setIsDetailsOpen(true);
        try {
            const { data } = await api.get(`/sales/staging/${sale.id}`);
            setSelectedSale(data);
            setEditablePrn(data.physical_receipt_no || '');
            setEditableTendered(data.tendered_amount || '');
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
                tendered_amount: editableTendered ? Number(editableTendered) : null
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
                detail: item.name
            })),
            selectedCustomer: selectedSale.customer_id,
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
        sale.customer_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const computedChange = () => {
        if (!selectedSale) return 0;
        const total = parseFloat(selectedSale.total_amount) || 0;
        const tendered = parseFloat(editableTendered) || 0;
        return tendered > total ? tendered - total : 0;
    };

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Cashier Staging Approval Desk</h1>
                    <p className="text-slate-500 text-sm">Approve, edit, or reject transactions staged from POS Mobile.</p>
                </div>

                <div className="relative max-w-xs w-full">
                    <input
                        type="text"
                        placeholder="Search staging ID or customer..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute left-3 top-2.5 text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </span>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 bg-slate-100 p-1 rounded-lg self-start">
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
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full ${tab.color}`} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Table Listing */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Queue List</span>
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-semibold">{filteredSales.length} items</span>
                </div>

                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="flex justify-center items-center py-20">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
                        </div>
                    ) : filteredSales.length === 0 ? (
                        <div className="flex flex-col justify-center items-center py-20 text-slate-400">
                            <Icon path={ICONS.pos} className="w-12 h-12 stroke-current mb-2 opacity-50" />
                            <span className="text-sm font-medium">Staging queue is empty</span>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm divide-y divide-slate-200">
                            <thead className="bg-slate-50 text-slate-500 font-bold">
                                <tr>
                                    <th className="px-6 py-3">Staging ID</th>
                                    <th className="px-6 py-3">Date Staged</th>
                                    <th className="px-6 py-3">Customer</th>
                                    <th className="px-6 py-3">Receipt No (PRN)</th>
                                    <th className="px-6 py-3">Payment Method</th>
                                    <th className="px-6 py-3 text-right">Total Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredSales.map(sale => (
                                    <tr
                                        key={sale.id}
                                        onClick={() => handleRowClick(sale)}
                                        className="hover:bg-blue-50/50 cursor-pointer transition-colors duration-150"
                                    >
                                        <td className="px-6 py-4 font-mono font-semibold text-slate-900">STG-{sale.id}</td>
                                        <td className="px-6 py-4 text-slate-500">{new Date(sale.timestamp).toLocaleString()}</td>
                                        <td className="px-6 py-4 text-slate-800 font-medium">{sale.customer_name}</td>
                                        <td className="px-6 py-4 font-mono text-slate-600">{sale.physical_receipt_no || '-'}</td>
                                        <td className="px-6 py-4"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">{sale.payment_method_name}</span></td>
                                        <td className="px-6 py-4 text-right font-bold text-slate-900">{sale.total_formatted}</td>
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
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
                        </div>
                    ) : selectedSale && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm text-sm">
                                <div><span className="text-slate-400 block text-[10px] uppercase font-bold">Staged By</span><span className="font-semibold text-slate-800">{selectedSale.cashier_name}</span></div>
                                <div><span className="text-slate-400 block text-[10px] uppercase font-bold">Customer</span><span className="font-semibold text-slate-800">{selectedSale.customer_name}</span></div>
                                <div className="mt-2">
                                    <label className="block text-slate-400 text-[10px] uppercase font-bold mb-1">Physical Receipt Number (PRN)</label>
                                    <input
                                        type="text"
                                        value={editablePrn}
                                        onChange={(e) => setEditablePrn(formatPhysicalReceiptNumber(e.target.value) || '')}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                                        placeholder="e.g. SI-1234, ABC/5678"
                                    />
                                </div>
                                <div className="mt-2">
                                    <label className="block text-slate-400 text-[10px] uppercase font-bold mb-1">Tendered Amount</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={editableTendered}
                                        onChange={(e) => setEditableTendered(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                                        placeholder="0.00"
                                    />
                                    {computedChange() > 0 && (
                                        <p className="text-[10px] text-emerald-600 font-semibold mt-1">Change: ₱{computedChange().toFixed(2)}</p>
                                    )}
                                </div>
                            </div>

                            <div>
                                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Item lines</span>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-left text-sm divide-y divide-slate-200">
                                        <thead className="bg-slate-50 text-slate-500 font-bold">
                                            <tr>
                                                <th className="px-4 py-2">Item Name</th>
                                                <th className="px-4 py-2">SKU</th>
                                                <th className="px-4 py-2 text-right">Qty</th>
                                                <th className="px-4 py-2 text-right">Price</th>
                                                <th className="px-4 py-2 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {selectedSale.items?.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td className="px-4 py-2.5 font-medium text-slate-800">{item.name}</td>
                                                    <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{item.sku}</td>
                                                    <td className="px-4 py-2.5 text-right font-medium">{item.qty}</td>
                                                    <td className="px-4 py-2.5 text-right">{item.price_formatted}</td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-slate-900">{item.total_formatted}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-slate-100">
                                <div className="w-64 space-y-1.5 text-sm text-slate-600">
                                    <div className="flex justify-between"><span>Subtotal (Excl. VAT)</span><span className="font-semibold text-slate-800">{selectedSale.subtotal_formatted}</span></div>
                                    <div className="flex justify-between text-xs text-slate-400"><span>VAT Amount ({selectedSale.tax_rate_name})</span><span>{selectedSale.tax_amount_formatted}</span></div>
                                    <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2 text-base"><span>Grand Total</span><span>{selectedSale.total_formatted}</span></div>
                                </div>
                            </div>

                            {activeFilter === 'PENDING' && (
                                <div className="flex justify-between items-center pt-6 border-t border-slate-100">
                                    <button
                                        onClick={handleEditConvert}
                                        className="px-5 py-2 border border-blue-200 text-blue-600 hover:bg-blue-50 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
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
                                            className="px-5 py-2 border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold rounded-lg transition-colors"
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
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden p-6 space-y-4">
                        <h2 className="text-base font-bold text-slate-900">Confirm Rejection</h2>
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">Reason Category</label>
                            <select
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none"
                            >
                                <option value="Pricing mismatch">Pricing mismatch / Incorrect discounts</option>
                                <option value="Customer signature missing">Customer signature missing</option>
                                <option value="Incorrect tax category">Incorrect tax category applied</option>
                                <option value="Invalid payment authorization">Invalid payment authorization</option>
                                <option value="Other">Other (Explain below)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">Internal Notes</label>
                            <textarea
                                rows={3}
                                value={rejectNotes}
                                onChange={(e) => setRejectNotes(e.target.value)}
                                placeholder="Notes visible to the cashier..."
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
                            />
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button onClick={() => setIsRejectOpen(false)} className="px-4 py-2 text-slate-600 hover:text-slate-800 text-xs font-bold">Cancel</button>
                            <button onClick={handleRejectSubmit} className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-sm">Reject</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
