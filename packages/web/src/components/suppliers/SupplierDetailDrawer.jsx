import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import SegmentedTabs from '../ui/SegmentedTabs';
import StatusBadge from '../ui/StatusBadge';
import Icon from '../ui/Icon';
import PaginationControls from '../ui/PaginationControls';
import { ICONS } from '../../constants';
import { formatCurrency } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import { supplierDocumentReference, supplierReference } from '../../utils/supplierReference';
import { makeNavContext } from '../../utils/apNavigationContract';
import AddPayableModal from '../accounts-payable/AddPayableModal';
import BillGoodsReceiptsModal from '../accounts-payable/BillGoodsReceiptsModal';
import BillReceiptViewer from '../accounts-payable/BillReceiptViewer';

const BILL_STATUS_TONE = { 'Unpaid': 'danger', 'Partially Paid': 'warning', 'Paid': 'success' };

const ProfileTab = ({ supplier, onSupplierUpdated, canManage }) => {
    const [holdReason, setHoldReason] = useState('');
    const [saving, setSaving] = useState(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { setHoldReason(supplier?.payment_hold_reason || ''); }, [supplier?.supplier_id]);

    const toggleHold = async (nextHold) => {
        if (nextHold && !holdReason.trim()) {
            toast.error('A reason is required to place a supplier on payment hold');
            return;
        }
        setSaving(true);
        try {
            const { data } = await api.patch(`/ap/suppliers/${supplier.supplier_id}/payment-hold`, {
                payment_hold: nextHold,
                payment_hold_reason: nextHold ? holdReason.trim() : null,
            });
            toast.success(nextHold ? 'Supplier placed on payment hold' : 'Payment hold lifted');
            onSupplierUpdated(data.data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update payment hold');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500 dark:text-slate-400">Contact Person</span><p className="text-gray-900 dark:text-slate-100">{supplier.contact_person || '—'}</p></div>
                <div><span className="text-gray-500 dark:text-slate-400">Phone</span><p className="text-gray-900 dark:text-slate-100">{supplier.phone || '—'}</p></div>
                <div><span className="text-gray-500 dark:text-slate-400">Email</span><p className="text-gray-900 dark:text-slate-100">{supplier.email || '—'}</p></div>
                <div><span className="text-gray-500 dark:text-slate-400">Payment Terms</span><p className="text-gray-900 dark:text-slate-100">{supplier.payment_terms_days ? `Net ${supplier.payment_terms_days}` : '—'}</p></div>
                <div className="col-span-2"><span className="text-gray-500 dark:text-slate-400">Address</span><p className="text-gray-900 dark:text-slate-100">{supplier.address || '—'}</p></div>
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Payment Hold</h3>
                    <StatusBadge tone={supplier.payment_hold ? 'danger' : 'success'} label={supplier.payment_hold ? 'ON HOLD' : 'CLEAR'} />
                </div>
                {supplier.payment_hold ? (
                    <>
                        <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{supplier.payment_hold_reason}</p>
                        {canManage && (
                            <button
                                onClick={() => toggleHold(false)}
                                disabled={saving}
                                className="w-full px-3 py-2 text-sm font-semibold rounded-md bg-success-600 text-white hover:bg-success-700 disabled:opacity-50"
                            >
                                Lift Payment Hold
                            </button>
                        )}
                    </>
                ) : canManage && (
                    <div className="space-y-2">
                        <textarea
                            value={holdReason}
                            onChange={(e) => setHoldReason(e.target.value)}
                            placeholder="Reason for placing this supplier on hold..."
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md"
                        />
                        <button
                            onClick={() => toggleHold(true)}
                            disabled={saving}
                            className="w-full px-3 py-2 text-sm font-semibold rounded-md bg-danger-600 text-white hover:bg-danger-700 disabled:opacity-50"
                        >
                            Place On Payment Hold
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const BillItemsPanel = ({ billId }) => {
    const [items, setItems] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get(`/ap/supplier-bills/${billId}/items`);
                setItems(data);
            } catch {
                toast.error('Failed to load attached items');
            } finally {
                setLoading(false);
            }
        })();
    }, [billId]);

    if (loading) return <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">Loading items...</div>;
    if (!items || items.data.length === 0) {
        return <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">No items attached to this bill yet.</div>;
    }

    return (
        <div className="mt-2 border-t border-gray-100 dark:border-slate-700 pt-2 space-y-1">
            {items.data.map((item) => (
                <div key={item.grn_line_id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 dark:text-slate-300 truncate max-w-[16rem]">{item.display_name || item.internal_sku}</span>
                    <span className="font-mono text-gray-600 dark:text-slate-400">{item.quantity} × {formatCurrency(item.cost_price)}</span>
                </div>
            ))}
            <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-gray-100 dark:border-slate-700">
                <span className="text-gray-700 dark:text-slate-300">Items Total vs Bill Total</span>
                <span className={Math.abs(items.variance) < 0.01 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}>
                    {formatCurrency(items.itemsTotal)} / {formatCurrency(items.billTotal)}
                </span>
            </div>
        </div>
    );
};

const BillsTab = ({ supplier, canManage, onNavigate, onRecordPayment, hostPageKey }) => {
    const { hasPermission } = useAuth();
    const [receiptBill, setReceiptBill] = useState(null);
    const closeReceipt = useCallback(() => setReceiptBill(null), []);
    const supplierId = supplier.supplier_id;
    const [bills, setBills] = useState([]);
    const [billSearch, setBillSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [editingBillId, setEditingBillId] = useState(null);
    const [newDueDate, setNewDueDate] = useState('');
    const [reason, setReason] = useState('');
    const [isAddPayableOpen, setIsAddPayableOpen] = useState(false);
    const [grnBill, setGrnBill] = useState(null);
    const [expandedBillId, setExpandedBillId] = useState(null);

    const fetchBills = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/ap/supplier-bills', { params: { supplier_id: supplierId, status: 'all' } });
            setBills(data?.data || []);
        } catch {
            toast.error('Failed to load bills');
        } finally {
            setLoading(false);
        }
    }, [supplierId]);

    useEffect(() => { fetchBills(); }, [fetchBills]);

    const handleAttachItems = (bill) => {
        const nav = makeNavContext({
            action: 'receive',
            supplierId: supplier.supplier_id,
            billId: bill.bill_id,
            source: { pageKey: hostPageKey, tab: 'bills' },
        });
        if (onNavigate) {
            onNavigate('goods_receipt', nav);
        }
    };

    const handlePayBill = (bill) => {
        if (onRecordPayment) {
            onRecordPayment({ supplier, billId: bill.bill_id });
        }
    };

    const startEdit = (bill) => {
        setEditingBillId(bill.bill_id);
        setNewDueDate(bill.due_date ? bill.due_date.slice(0, 10) : '');
        setReason('');
    };

    const saveDueDate = async (billId) => {
        if (!newDueDate) { toast.error('Select a due date'); return; }
        try {
            await api.patch(`/ap/supplier-bills/${billId}/due-date`, { new_due_date: newDueDate, reason: reason.trim() || null });
            toast.success('Due date updated');
            setEditingBillId(null);
            fetchBills();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update due date');
        }
    };

    if (loading) return <div className="p-4 text-sm text-gray-500 dark:text-slate-400">Loading bills...</div>;

    return (
        <div className="p-4 space-y-3">
            {canManage && (
                <button
                    onClick={() => setIsAddPayableOpen(true)}
                    className="w-full px-3 py-2 text-sm font-semibold rounded-md border border-dashed border-primary-400 dark:border-primary-600 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 flex items-center justify-center gap-1.5"
                >
                    <Icon path={ICONS.plus} className="h-4 w-4" /> New Payable
                </button>
            )}

            {bills.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No bills recorded for this supplier.</p>}
            <label className="block text-sm text-gray-700 dark:text-slate-300">Find supplier document
                <input type="search" value={billSearch} onChange={e => setBillSearch(e.target.value)} placeholder="Supplier document number"
                    className="mt-1 w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2" />
            </label>
            {bills.filter(b => !billSearch.trim() || [supplierReference(b), b.bill_number, ...(b.document_references || [])].some(ref => String(ref || '').toLowerCase().includes(billSearch.trim().toLowerCase()))).map((bill) => (
                <div key={bill.bill_id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Supplier reference</p>
                            <p data-supplier-reference className="mt-0.5 break-words font-mono text-lg font-bold leading-snug text-gray-900 dark:text-slate-100">
                                {supplierDocumentReference(bill) || 'No supplier reference recorded'}
                            </p>
                            <p data-internal-bill className="mt-1 text-xs text-gray-500 dark:text-slate-400">Internal bill: {bill.bill_number}</p>
                        </div>
                        <StatusBadge tone={BILL_STATUS_TONE[bill.status] || 'neutral'} label={bill.status} />
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-slate-400 flex flex-wrap justify-between gap-2">
                        <span>Total: {formatCurrency(bill.total_amount)}</span>
                        <span>Paid: {formatCurrency(bill.amount_paid)}</span>
                        {Number(bill.scheduled_amount) > 0 && (
                            <span className="text-warning-700 dark:text-warning-400">
                                Scheduled: {formatCurrency(bill.scheduled_amount)}
                            </span>
                        )}
                        {bill.available_to_schedule !== undefined && bill.status !== 'Paid' && (
                            <span className="font-semibold text-gray-900 dark:text-slate-100">
                                Available: {formatCurrency(bill.available_to_schedule)}
                            </span>
                        )}
                    </div>
                    {/* The receipt behind the payable, named right on the row: before paying,
                        the question is which delivery this bill is charging for, and a bill
                        number alone cannot answer it. */}
                    {(bill.related_grns || []).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-gray-500 dark:text-slate-400">From:</span>
                            {bill.related_grns.map((grn) => (
                                <button
                                    key={grn.grn_id}
                                    onClick={() => setGrnBill(bill)}
                                    title={`View ${grn.grn_number} — received ${new Date(grn.receipt_date).toLocaleDateString()}`}
                                    className={`text-xs font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                        grn.status === 'Voided'
                                            ? 'border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 line-through'
                                            : 'border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                                    }`}
                                >
                                    {grn.grn_number}{grn.link_type === 'freight' ? ' (freight)' : ''}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-slate-400">
                            Due: {bill.due_date ? new Date(bill.due_date).toLocaleDateString() : 'Not set'}
                            {bill.status !== 'Paid' && Number(bill.days_overdue) > 0 && (
                                <span className="ml-2 text-danger-600 dark:text-danger-400 font-semibold">{Math.round(bill.days_overdue)}d overdue</span>
                            )}
                        </span>
                        {canManage && bill.status !== 'Paid' && (
                            <button onClick={() => startEdit(bill)} className="text-primary-600 dark:text-primary-400 text-xs font-semibold hover:underline">Edit Due Date</button>
                        )}
                    </div>
                    {editingBillId === bill.bill_id && (
                        <div className="mt-2 space-y-2 border-t border-gray-100 dark:border-slate-700 pt-2">
                            <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md" />
                            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
                                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md" />
                            <div className="flex gap-2">
                                <button onClick={() => saveDueDate(bill.bill_id)} className="flex-1 px-2 py-1 text-xs font-semibold bg-primary-600 text-white rounded-md">Save</button>
                                <button onClick={() => setEditingBillId(null)} className="flex-1 px-2 py-1 text-xs font-semibold border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-slate-200">Cancel</button>
                            </div>
                        </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-gray-100 dark:border-slate-700 pt-2">
                        {hasPermission('documents:view') && (
                            <button type="button" onClick={() => setReceiptBill(bill)}
                                className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                                View receipt
                            </button>
                        )}
                        <button
                            onClick={() => setExpandedBillId(expandedBillId === bill.bill_id ? null : bill.bill_id)}
                            className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:underline"
                        >
                            {expandedBillId === bill.bill_id ? 'Hide Items' : 'View Items'}
                        </button>
                        {(bill.related_grns || []).length > 0 && (
                            <button
                                onClick={() => setGrnBill(bill)}
                                className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                            >
                                View Goods Receipt{bill.related_grns.length > 1 ? 's' : ''}
                            </button>
                        )}
                        {canManage && bill.status !== 'Paid' && (
                            <>
                                <button
                                    onClick={() => handleAttachItems(bill)}
                                    className="text-xs font-semibold text-success-600 dark:text-success-400 hover:underline"
                                >
                                    Attach Items
                                </button>
                                <button
                                    onClick={() => handlePayBill(bill)}
                                    className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                >
                                    Pay This Bill
                                </button>
                            </>
                        )}
                    </div>
                    {expandedBillId === bill.bill_id && <BillItemsPanel billId={bill.bill_id} />}
                </div>
            ))}

            <AddPayableModal
                isOpen={isAddPayableOpen}
                onClose={() => setIsAddPayableOpen(false)}
                onCreated={fetchBills}
                presetSupplier={{ supplier_id: supplier.supplier_id, supplier_name: supplier.supplier_name }}
            />
            {receiptBill && <BillReceiptViewer bill={receiptBill} onClose={closeReceipt} />}
            <BillGoodsReceiptsModal
                isOpen={!!grnBill}
                onClose={() => setGrnBill(null)}
                bill={grnBill}
            />
        </div>
    );
};

const PaymentsTab = ({ supplierId }) => {
    const [payments, setPayments] = useState([]);
    const [includeHistory, setIncludeHistory] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get(`/ap/suppliers/${supplierId}/payments`, {
                    params: { include_history: includeHistory ? 'true' : undefined },
                });
                setPayments(data?.data || []);
            } catch {
                toast.error('Failed to load payments');
            } finally {
                setLoading(false);
            }
        })();
    }, [supplierId, includeHistory]);

    if (loading) return <div className="p-4 text-sm text-gray-500 dark:text-slate-400">Loading payments...</div>;

    return (
        <div className="p-4 space-y-3">
            <div className="flex justify-end">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-400 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeHistory}
                        onChange={(e) => setIncludeHistory(e.target.checked)}
                        className="rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span>Show replaced / voided attempts</span>
                </label>
            </div>
            {payments.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No payments recorded for this supplier.</p>}
            {payments.map((p) => (
                <div key={p.payment_id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-gray-900 dark:text-slate-100 font-medium">{formatCurrency(p.amount)}</span>
                        <StatusBadge tone={p.pdc_status === 'CLEARED' ? 'success' : p.pdc_status === 'BOUNCED' ? 'danger' : ['REPLACED', 'VOID'].includes(p.pdc_status) ? 'neutral' : 'info'} label={p.pdc_status} />
                    </div>
                    <div className="mt-1 text-gray-500 dark:text-slate-400">
                        {String(p.cheque_date || p.payment_date || '').slice(0, 10)} · {p.method_name || 'Unknown method'}
                        {p.cheque_number ? ` · Cheque #${p.cheque_number}` : (p.reference_number ? ` · Ref ${p.reference_number}` : '')}
                    </div>
                    {(p.replaces_cheque_number || p.replaced_by_cheque_number) && (
                        <div className="mt-1 text-xs font-mono text-primary-700 dark:text-primary-400">
                            {p.replaces_cheque_number && <span>↳ Replaces #{p.replaces_cheque_number} </span>}
                            {p.replaced_by_cheque_number && <span>→ Replaced by #{p.replaced_by_cheque_number}</span>}
                        </div>
                    )}
                    {p.allocations?.length > 0 && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                            Applied to: {p.allocations.map(a => supplierReference(a)).join(', ')}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

const LedgerTab = ({ supplierId }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get(`/ap/suppliers/${supplierId}/ledger`, { params: { limit: 200 } });
                setRows(data?.rows || []);
            } catch {
                toast.error('Failed to load ledger');
            } finally {
                setLoading(false);
            }
        })();
    }, [supplierId]);

    if (loading) return <div className="p-4 text-sm text-gray-500 dark:text-slate-400">Loading ledger...</div>;

    return (
        <div className="p-4">
            {rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No ledger activity for this supplier.</p>}
            <div className="space-y-2">
                {rows.map((r) => (
                    <div key={r.ledger_id} className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-slate-700 pb-2">
                        <div>
                            <p className="text-gray-900 dark:text-slate-100 font-medium">{r.entry_type.replace(/_/g, ' ')}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">{new Date(r.created_at).toLocaleString()} {r.bill_number ? `· ${supplierReference(r)}` : ''}</p>
                        </div>
                        <div className="text-right">
                            <p className={`font-mono font-semibold ${Number(r.amount) >= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                                {Number(r.amount) >= 0 ? '+' : ''}{formatCurrency(r.amount)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Bal: {formatCurrency(r.balance_after)}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ReceiptsTab = ({ supplier, onNavigate, hostPageKey }) => {
    const { hasPermission } = useAuth();
    const canCreateReceipt = hasPermission('goods_receipt:create');
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedGrn, setSelectedGrn] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [grnDetails, setGrnDetails] = useState(null);
    const [grnLines, setGrnLines] = useState([]);

    const fetchReceipts = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/goods-receipts', {
                params: {
                    supplier_id: supplier.supplier_id,
                    workflow_status: statusFilter,
                    page,
                    pageSize,
                    paginated: 1,
                },
            });
            setReceipts(data?.data || []);
            setTotal(data?.total || 0);
        } catch {
            toast.error('Failed to load goods receipts');
        } finally {
            setLoading(false);
        }
    }, [supplier.supplier_id, statusFilter, page, pageSize]);

    useEffect(() => {
        fetchReceipts();
    }, [fetchReceipts]);

    const handleViewDetails = async (grn) => {
        setSelectedGrn(grn);
        setDetailLoading(true);
        try {
            const [linesRes, headerRes] = await Promise.all([
                api.get(`/goods-receipts/${grn.grn_id}/lines`),
                api.get(`/goods-receipts/${grn.grn_id}`),
            ]);
            setGrnLines(linesRes.data || []);
            setGrnDetails(headerRes.data || grn);
        } catch {
            toast.error('Failed to load receipt details');
        } finally {
            setDetailLoading(false);
        }
    };

    const handleResumeDraft = (grn) => {
        const nav = makeNavContext({
            action: 'resume',
            grnId: grn.grn_id,
            supplierId: supplier.supplier_id,
            source: { pageKey: hostPageKey, tab: 'receipts' },
        });
        if (onNavigate) onNavigate('goods_receipt', nav);
    };

    return (
        <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 dark:text-slate-400">Status:</label>
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-md text-gray-900 dark:text-slate-100"
                    >
                        <option value="all">All Statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Draft">Draft</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="Voided">Voided</option>
                    </select>
                </div>
                {canCreateReceipt && (
                    <button
                        onClick={() => {
                            const nav = makeNavContext({
                                action: 'receive',
                                supplierId: supplier.supplier_id,
                                source: { pageKey: hostPageKey, tab: 'receipts' },
                            });
                            if (onNavigate) onNavigate('goods_receipt', nav);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-md border border-dashed border-primary-500 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 flex items-center gap-1"
                    >
                        <Icon path={ICONS.plus} className="h-3.5 w-3.5" /> Receive Goods
                    </button>
                )}
            </div>

            {loading ? (
                <div className="p-4 text-sm text-gray-500 dark:text-slate-400">Loading goods receipts...</div>
            ) : receipts.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 dark:text-slate-400">No goods receipts found for this supplier.</p>
            ) : (
                <div className="space-y-2">
                    {receipts.map((grn) => {
                        const isDraft = ['Draft', 'Submitted'].includes(grn.workflow_status);
                        const isVoided = grn.status === 'Voided' || grn.workflow_status === 'Voided';
                        const docRef = grn.supplier_document_no || grn.physical_receipt_no || grn.supplier_invoice_no;
                        return (
                            <div key={grn.grn_id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-mono font-medium ${isVoided ? 'line-through text-gray-400' : 'text-gray-900 dark:text-slate-100'}`}>
                                            {grn.grn_number}
                                        </span>
                                        {isDraft && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                                                {grn.workflow_status} (In progress)
                                            </span>
                                        )}
                                        {isVoided && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500">
                                                Voided
                                            </span>
                                        )}
                                        {grn.workflow_status === 'Posted' && !isVoided && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400">
                                                Posted
                                            </span>
                                        )}
                                        {grn.workflow_status === 'Cancelled' && (
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-600">
                                                Cancelled
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-gray-500 dark:text-slate-400">
                                        {new Date(grn.receipt_date).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-slate-400">
                                    <div>
                                        <span className="text-gray-500 mr-1">Doc:</span>
                                        {docRef ? (
                                            <span className="font-mono bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-gray-900 dark:text-slate-200">
                                                {docRef}
                                            </span>
                                        ) : (
                                            <span className="italic text-gray-400">No supplier document available</span>
                                        )}
                                    </div>
                                    {grn.bill_number && (
                                        <div>
                                            <span className="text-gray-500 mr-1">Linked Bill:</span>
                                            <span className="font-mono text-primary-600 dark:text-primary-400">
                                                {grn.bill_supplier_document_no || grn.bill_number}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="mt-2 flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-slate-700/60">
                                    <button
                                        onClick={() => handleViewDetails(grn)}
                                        className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                    >
                                        View Details
                                    </button>
                                    {isDraft && canCreateReceipt && (
                                        <button
                                            onClick={() => handleResumeDraft(grn)}
                                            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                                        >
                                            Resume Draft
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <PaginationControls
                        page={page}
                        pageSize={pageSize}
                        total={total}
                        onPageChange={setPage}
                        onPageSizeChange={(v) => { setPageSize(v); setPage(1); }}
                    />
                </div>
            )}

            {selectedGrn && (
                <Modal
                    isOpen={!!selectedGrn}
                    onClose={() => { setSelectedGrn(null); setGrnDetails(null); setGrnLines([]); }}
                    title={`Receipt Details — ${selectedGrn.grn_number}`}
                    maxWidth="max-w-4xl"
                >
                    {detailLoading ? (
                        <div className="p-4 text-center text-gray-500">Loading details...</div>
                    ) : (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-gray-50 dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700">
                                <div><span className="text-gray-500 text-xs">Receipt Date:</span><p className="font-medium">{new Date(selectedGrn.receipt_date).toLocaleDateString()}</p></div>
                                <div><span className="text-gray-500 text-xs">Workflow:</span><p className="font-medium">{selectedGrn.workflow_status || selectedGrn.status}</p></div>
                                <div><span className="text-gray-500 text-xs">Supplier Document:</span><p className="font-mono">{selectedGrn.supplier_document_no || selectedGrn.physical_receipt_no || selectedGrn.supplier_invoice_no || '—'}</p></div>
                                <div><span className="text-gray-500 text-xs">Received By:</span><p className="font-medium">{grnDetails?.received_by_name || selectedGrn.employee_name || '—'}</p></div>
                                {selectedGrn.bill_number && (
                                    <div><span className="text-gray-500 text-xs">Linked Bill:</span><p className="font-mono text-primary-600">{selectedGrn.bill_supplier_document_no || selectedGrn.bill_number}</p></div>
                                )}
                                {Number(selectedGrn.freight_amount) > 0 && (
                                    <div><span className="text-gray-500 text-xs">Freight Amount:</span><p className="font-mono">{formatCurrency(selectedGrn.freight_amount)}</p></div>
                                )}
                            </div>

                            <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300">
                                        <tr>
                                            <th className="p-2">Part</th>
                                            <th className="p-2 text-right">Quantity</th>
                                            <th className="p-2 text-right">Returned</th>
                                            <th className="p-2 text-right">Cost Price</th>
                                            <th className="p-2 text-right">Landed Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                        {grnLines.map((l) => (
                                            <tr key={l.grn_line_id}>
                                                <td className="p-2 font-mono">{l.internal_sku || l.display_name || `Part #${l.part_id}`}</td>
                                                <td className="p-2 text-right font-mono">{l.quantity}</td>
                                                <td className="p-2 text-right font-mono text-amber-600">{l.return_quantity || 0}</td>
                                                <td className="p-2 text-right font-mono">{formatCurrency(l.cost_price)}</td>
                                                <td className="p-2 text-right font-mono">{formatCurrency(l.landed_unit_cost || l.cost_price)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
};

const SupplierDetailDrawer = ({
    supplier,
    isOpen,
    onClose,
    onSupplierUpdated,
    initialTab = 'profile',
    onNavigate = null,
    onRecordPayment = null,
    hostPageKey = 'ap',
}) => {
    const { hasPermission } = useAuth();
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => { if (isOpen) setActiveTab(initialTab); }, [isOpen, initialTab, supplier?.supplier_id]);

    if (!supplier) return null;

    const tabs = [
        { key: 'profile', label: 'Profile' },
        { key: 'bills', label: 'Bills' },
        { key: 'receipts', label: 'Goods Receipts' },
        { key: 'payments', label: 'Payments' },
        { key: 'ledger', label: 'Ledger' },
    ];

    const modalTitle = (
        <div className="flex flex-wrap items-center justify-between gap-3 w-full pr-6">
            <span className="flex items-center gap-2">
                {supplier.supplier_name}
                {supplier.payment_hold && <StatusBadge tone="danger" label="ON HOLD" />}
            </span>
            <div className="flex items-center gap-2">
                {hasPermission('goods_receipt:create') && (
                    <button
                        type="button"
                        onClick={() => {
                            const nav = makeNavContext({
                                action: 'receive',
                                supplierId: supplier.supplier_id,
                                source: { pageKey: hostPageKey, tab: 'receipts' },
                            });
                            if (onNavigate) onNavigate('goods_receipt', nav);
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-md border border-primary-500 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 flex items-center gap-1"
                    >
                        <Icon path={ICONS.plus} className="h-3.5 w-3.5" /> Receive Goods
                    </button>
                )}
                {hasPermission('ap:manage') && (
                    <button
                        type="button"
                        onClick={() => {
                            if (onRecordPayment) onRecordPayment({ supplier, billId: null });
                        }}
                        className="px-2.5 py-1 text-xs font-semibold rounded-md bg-success-600 text-white hover:bg-success-700 flex items-center gap-1"
                    >
                        <Icon path={ICONS.dollar} className="h-3.5 w-3.5" /> Record Payment
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="max-w-3xl">
            <div className="-mt-2 mb-3">
                <SegmentedTabs tabs={tabs} active={activeTab} onChange={setActiveTab} variant="pills" />
            </div>
            <div className="-mx-6">
                {activeTab === 'profile' && (
                    <ProfileTab supplier={supplier} onSupplierUpdated={onSupplierUpdated} canManage={hasPermission('ap:manage')} />
                )}
                {activeTab === 'bills' && (
                    <BillsTab
                        supplier={supplier}
                        canManage={hasPermission('ap:manage')}
                        onNavigate={onNavigate}
                        onRecordPayment={onRecordPayment}
                        hostPageKey={hostPageKey}
                    />
                )}
                {activeTab === 'receipts' && (
                    <ReceiptsTab
                        supplier={supplier}
                        onNavigate={onNavigate}
                        hostPageKey={hostPageKey}
                    />
                )}
                {activeTab === 'payments' && <PaymentsTab supplierId={supplier.supplier_id} />}
                {activeTab === 'ledger' && <LedgerTab supplierId={supplier.supplier_id} />}
            </div>
        </Modal>
    );
};

export default SupplierDetailDrawer;
