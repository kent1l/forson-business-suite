import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import SegmentedTabs from '../ui/SegmentedTabs';
import StatusBadge from '../ui/StatusBadge';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { formatCurrency } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import AddPayableModal from '../accounts-payable/AddPayableModal';
import AttachItemsModal from '../accounts-payable/AttachItemsModal';

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

const BillsTab = ({ supplier, canManage }) => {
    const supplierId = supplier.supplier_id;
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingBillId, setEditingBillId] = useState(null);
    const [newDueDate, setNewDueDate] = useState('');
    const [reason, setReason] = useState('');
    const [isAddPayableOpen, setIsAddPayableOpen] = useState(false);
    const [attachItemsBill, setAttachItemsBill] = useState(null);
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
            {bills.map((bill) => (
                <div key={bill.bill_id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                        <span className="font-mono text-sm text-gray-900 dark:text-slate-100">{bill.bill_number || `Bill #${bill.bill_id}`}</span>
                        <StatusBadge tone={BILL_STATUS_TONE[bill.status] || 'neutral'} label={bill.status} />
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-slate-400 flex justify-between">
                        <span>Total: {formatCurrency(bill.total_amount)}</span>
                        <span>Paid: {formatCurrency(bill.amount_paid)}</span>
                    </div>
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

                    <div className="mt-2 flex items-center gap-3 border-t border-gray-100 dark:border-slate-700 pt-2">
                        <button
                            onClick={() => setExpandedBillId(expandedBillId === bill.bill_id ? null : bill.bill_id)}
                            className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:underline"
                        >
                            {expandedBillId === bill.bill_id ? 'Hide Items' : 'View Items'}
                        </button>
                        {canManage && bill.status !== 'Paid' && (
                            <button
                                onClick={() => setAttachItemsBill(bill)}
                                className="text-xs font-semibold text-success-600 dark:text-success-400 hover:underline"
                            >
                                Attach Items
                            </button>
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
            <AttachItemsModal
                isOpen={!!attachItemsBill}
                onClose={() => setAttachItemsBill(null)}
                supplierId={supplierId}
                supplierName={supplier.supplier_name}
                bill={attachItemsBill}
                onAttached={fetchBills}
            />
        </div>
    );
};

const PaymentsTab = ({ supplierId }) => {
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get(`/ap/suppliers/${supplierId}/payments`);
                setPayments(data?.data || []);
            } catch {
                toast.error('Failed to load payments');
            } finally {
                setLoading(false);
            }
        })();
    }, [supplierId]);

    if (loading) return <div className="p-4 text-sm text-gray-500 dark:text-slate-400">Loading payments...</div>;

    return (
        <div className="p-4 space-y-3">
            {payments.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No payments recorded for this supplier.</p>}
            {payments.map((p) => (
                <div key={p.payment_id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-gray-900 dark:text-slate-100 font-medium">{formatCurrency(p.amount)}</span>
                        <StatusBadge tone={p.pdc_status === 'CLEARED' ? 'success' : p.pdc_status === 'BOUNCED' ? 'danger' : 'info'} label={p.pdc_status} />
                    </div>
                    <div className="mt-1 text-gray-500 dark:text-slate-400">
                        {new Date(p.payment_date).toLocaleDateString()} · {p.method_name || 'Unknown method'} {p.reference_number ? `· Ref ${p.reference_number}` : ''}
                    </div>
                    {p.allocations?.length > 0 && (
                        <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                            Applied to: {p.allocations.map(a => a.bill_number || `Bill #${a.bill_id}`).join(', ')}
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
                            <p className="text-xs text-gray-500 dark:text-slate-400">{new Date(r.created_at).toLocaleString()} {r.bill_number ? `· ${r.bill_number}` : ''}</p>
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

const SupplierDetailDrawer = ({ supplier, isOpen, onClose, onSupplierUpdated, initialTab = 'profile' }) => {
    const { hasPermission } = useAuth();
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => { if (isOpen) setActiveTab(initialTab); }, [isOpen, initialTab, supplier?.supplier_id]);

    if (!supplier) return null;

    const tabs = [
        { key: 'profile', label: 'Profile' },
        { key: 'bills', label: 'Bills' },
        { key: 'payments', label: 'Payments' },
        { key: 'ledger', label: 'Ledger' },
    ];

    const modalTitle = (
        <span className="flex items-center gap-2">
            {supplier.supplier_name}
            {supplier.payment_hold && <StatusBadge tone="danger" label="ON HOLD" />}
        </span>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="max-w-2xl">
            <div className="-mt-2 mb-3">
                <SegmentedTabs tabs={tabs} active={activeTab} onChange={setActiveTab} variant="pills" />
            </div>
            <div className="-mx-6">
                {activeTab === 'profile' && (
                    <ProfileTab supplier={supplier} onSupplierUpdated={onSupplierUpdated} canManage={hasPermission('ap:manage')} />
                )}
                {activeTab === 'bills' && <BillsTab supplier={supplier} canManage={hasPermission('ap:manage')} />}
                {activeTab === 'payments' && <PaymentsTab supplierId={supplier.supplier_id} />}
                {activeTab === 'ledger' && <LedgerTab supplierId={supplier.supplier_id} />}
            </div>
        </Modal>
    );
};

export default SupplierDetailDrawer;
