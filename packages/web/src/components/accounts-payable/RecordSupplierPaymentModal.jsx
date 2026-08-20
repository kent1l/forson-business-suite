import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import InfoTip from '../ui/InfoTip';
import { formatCurrency } from '../../utils/currency';

const today = () => new Date().toISOString().slice(0, 10);

const BLANK_FORM = {
    supplier_id: '',
    method_id: '',
    amount: '',
    settlement_date: today(),
    reference_number: '',
    bank_account_id: '',
    notes: '',
};

const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500";
const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";

const outstandingOf = (bill) => Number(bill.total_amount) - Number(bill.amount_paid);

/**
 * Settles supplier bills with a payment that has no instrument lifecycle —
 * cash, bank transfer, e-wallet. Cheques are deliberately absent from the
 * method list (the API filters them out) because they must be issued from the
 * Treasury desk so a cheque record exists to clear or bounce later.
 *
 * The settlement date is the day the money actually left, which is often before
 * today — the usual case is a payment nobody got around to recording. Once
 * saved, correcting it requires the transaction:change_date permission and a
 * written reason, via ChangeTransactionDateModal.
 */
const RecordSupplierPaymentModal = ({ isOpen, onClose, onRecorded, presetSupplier = null }) => {
    const [suppliers, setSuppliers] = useState([]);
    const [methods, setMethods] = useState([]);
    const [bankAccounts, setBankAccounts] = useState([]);
    const [bills, setBills] = useState([]);
    const [allocations, setAllocations] = useState({});
    const [autoAllocate, setAutoAllocate] = useState(true);
    const [form, setForm] = useState(BLANK_FORM);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setForm({ ...BLANK_FORM, supplier_id: presetSupplier?.supplier_id || '' });
        setAllocations({});
        setAutoAllocate(true);
        setBills([]);

        api.get('/ap/payment-methods')
            .then(res => setMethods(res.data?.data || []))
            .catch(() => toast.error('Failed to load payment methods'));
        api.get('/bank-accounts')
            .then(res => setBankAccounts((res.data?.data || []).filter(a => a.is_active)))
            .catch(() => { /* optional field — a missing list just leaves it empty */ });
        if (!presetSupplier) {
            api.get('/suppliers', { params: { status: 'active' } })
                .then(res => setSuppliers(res.data?.data || res.data || []))
                .catch(() => toast.error('Failed to load suppliers'));
        }
    }, [isOpen, presetSupplier]);

    const supplierId = form.supplier_id;
    useEffect(() => {
        if (!isOpen || !supplierId) { setBills([]); return; }
        api.get('/ap/supplier-bills', { params: { supplier_id: supplierId } })
            .then(res => setBills((res.data?.data || []).filter(b => b.status !== 'Void' && outstandingOf(b) > 0)))
            .catch(() => toast.error('Failed to load open bills'));
        setAllocations({});
    }, [isOpen, supplierId]);

    const selectedMethod = useMemo(
        () => methods.find(m => String(m.method_id) === String(form.method_id)),
        [methods, form.method_id]
    );
    const methodConfig = selectedMethod?.config || {};
    const referenceLabel = methodConfig.reference_label || 'Reference Number';
    const referenceRequired = Boolean(methodConfig.requires_reference);
    // A bank-type method moved money out of one of our accounts, so knowing
    // which one is what makes the payment reconcilable against a statement.
    const showBankAccount = selectedMethod?.type === 'bank' || selectedMethod?.type === 'mobile';

    const totalOutstanding = useMemo(
        () => bills.reduce((sum, b) => sum + outstandingOf(b), 0),
        [bills]
    );
    const allocatedTotal = useMemo(
        () => Object.values(allocations).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
        [allocations]
    );

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const applyOldestFirst = useCallback(() => {
        let remaining = parseFloat(form.amount) || 0;
        const next = {};
        for (const bill of bills) {
            if (remaining <= 0.005) break;
            const applied = Math.min(outstandingOf(bill), remaining);
            next[bill.bill_id] = applied.toFixed(2);
            remaining -= applied;
        }
        setAllocations(next);
    }, [bills, form.amount]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const amount = parseFloat(form.amount);
        if (!form.supplier_id) { toast.error('Select a supplier'); return; }
        if (!form.method_id) { toast.error('Select a payment method'); return; }
        if (!amount || amount <= 0) { toast.error('Enter a valid payment amount'); return; }
        if (referenceRequired && !form.reference_number.trim()) {
            toast.error(`${referenceLabel} is required for ${selectedMethod.name} payments`);
            return;
        }
        if (form.settlement_date > today()) { toast.error('Settlement date cannot be in the future'); return; }
        if (!autoAllocate && Math.abs(allocatedTotal - amount) > 0.005) {
            toast.error('Allocations must add up to the payment amount');
            return;
        }

        const payload = {
            supplier_id: form.supplier_id,
            method_id: form.method_id,
            amount,
            settlement_date: form.settlement_date || undefined,
            reference_number: form.reference_number.trim() || undefined,
            bank_account_id: showBankAccount ? (form.bank_account_id || undefined) : undefined,
            notes: form.notes.trim() || undefined,
        };
        if (!autoAllocate) {
            payload.allocations = Object.entries(allocations)
                .map(([bill_id, value]) => ({ bill_id: Number(bill_id), amount: parseFloat(value) }))
                .filter(a => a.amount > 0);
        }

        setSaving(true);
        try {
            const res = await api.post('/ap/payments', payload);
            const applied = res.data?.data?.allocations?.length || 0;
            toast.success(`Payment recorded against ${applied} bill${applied === 1 ? '' : 's'}`);
            onRecorded && onRecorded();
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to record payment');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record Supplier Payment" maxWidth="max-w-2xl">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Supplier</label>
                        {presetSupplier ? (
                            <div className="px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm">
                                {presetSupplier.supplier_name}
                            </div>
                        ) : (
                            <Combobox
                                options={suppliers.map(s => ({ value: s.supplier_id, label: s.supplier_name }))}
                                value={form.supplier_id}
                                onChange={(val) => handleChange('supplier_id', val)}
                                placeholder="Select a Supplier"
                            />
                        )}
                    </div>
                    <div>
                        <label className={labelClass + ' flex items-center gap-1'}>
                            Payment Method
                            <InfoTip label="Payment Method">
                                Cash, bank transfer and e-wallet payments are recorded here as already settled. Cheques are not listed — issue those from Outbound Cheques &amp; Treasury so the cheque can be cleared or bounced later.
                            </InfoTip>
                        </label>
                        <select value={form.method_id} onChange={(e) => handleChange('method_id', e.target.value)} className={inputClass} required>
                            <option value="">Select a method</option>
                            {methods.map(m => <option key={m.method_id} value={m.method_id}>{m.name}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Amount</label>
                        <input type="number" step="0.01" min="0" required value={form.amount}
                            onChange={(e) => handleChange('amount', e.target.value)} className={inputClass} />
                        {supplierId && (
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Outstanding: {formatCurrency(totalOutstanding)}
                            </p>
                        )}
                    </div>
                    <div>
                        <label className={labelClass + ' flex items-center gap-1'}>
                            Settlement Date
                            <InfoTip label="Settlement Date">
                                The day the money actually left, not the day you're recording it. Defaults to today and can be backdated for a payment made earlier. It cannot be in the future, or earlier than the bills it settles. Changing it after saving needs a permission and a written reason.
                            </InfoTip>
                        </label>
                        <input type="date" max={today()} value={form.settlement_date}
                            onChange={(e) => handleChange('settlement_date', e.target.value)} className={inputClass} />
                    </div>
                </div>

                {selectedMethod && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelClass}>
                                {referenceLabel}{referenceRequired && <span className="text-danger-600"> *</span>}
                            </label>
                            <input type="text" value={form.reference_number} required={referenceRequired}
                                onChange={(e) => handleChange('reference_number', e.target.value)}
                                placeholder={referenceRequired ? `Required for ${selectedMethod.name}` : 'Optional'}
                                className={inputClass} />
                        </div>
                        {showBankAccount && (
                            <div>
                                <label className={labelClass}>Paid From Account</label>
                                <select value={form.bank_account_id} onChange={(e) => handleChange('bank_account_id', e.target.value)} className={inputClass}>
                                    <option value="">Not specified</option>
                                    {bankAccounts.map(a => (
                                        <option key={a.bank_account_id} value={a.bank_account_id}>
                                            {a.account_name} — {a.bank_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {bills.length > 0 && (
                    <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Apply To Bills</span>
                            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400">
                                <input type="checkbox" checked={autoAllocate}
                                    onChange={(e) => { setAutoAllocate(e.target.checked); if (!e.target.checked) applyOldestFirst(); }} />
                                Apply oldest first automatically
                            </label>
                        </div>

                        {autoAllocate ? (
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                The payment will be applied to the {bills.length} open bill{bills.length === 1 ? '' : 's'} in due-date order.
                            </p>
                        ) : (
                            <>
                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700">
                                    {bills.map(bill => (
                                        <div key={bill.bill_id} className="flex items-center gap-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-gray-900 dark:text-slate-100 truncate">{bill.bill_number || `Bill #${bill.bill_id}`}</p>
                                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                                    Outstanding {formatCurrency(outstandingOf(bill))}
                                                    {bill.due_date ? ` · due ${new Date(bill.due_date).toLocaleDateString()}` : ''}
                                                </p>
                                            </div>
                                            <input type="number" step="0.01" min="0" max={outstandingOf(bill)}
                                                value={allocations[bill.bill_id] || ''}
                                                onChange={(e) => setAllocations(prev => ({ ...prev, [bill.bill_id]: e.target.value }))}
                                                placeholder="0.00"
                                                className="w-32 px-2 py-1 text-sm text-right border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md" />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between text-sm pt-1 border-t border-gray-200 dark:border-slate-700">
                                    <span className="text-gray-600 dark:text-slate-400">Allocated</span>
                                    <span className={Math.abs(allocatedTotal - (parseFloat(form.amount) || 0)) > 0.005
                                        ? 'font-medium text-danger-600 dark:text-danger-400'
                                        : 'font-medium text-success-600 dark:text-success-400'}>
                                        {formatCurrency(allocatedTotal)} of {formatCurrency(parseFloat(form.amount) || 0)}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {supplierId && bills.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                        This supplier has no open bills. Record a payable first — a payment cannot be larger than what is owed.
                    </p>
                )}

                <div>
                    <label className={labelClass}>Notes</label>
                    <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2} className={inputClass} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                    <button type="submit" disabled={saving || bills.length === 0} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                        {saving ? 'Recording...' : 'Record Payment'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default RecordSupplierPaymentModal;
