import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from '../ui/MathExpressionInput';
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
    cheque_number: '',
    cheque_date: today(),
};

const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500";
const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";

const outstandingOf = (bill) => Number(bill.total_amount) - Number(bill.amount_paid);

/**
 * Settles supplier bills, whatever the payment was made with.
 *
 * Cash, bank transfer and e-wallet are recorded as already settled: the money
 * has left and there is no instrument left to track. A cheque has not settled
 * anything yet — it still has to be deposited and can clear, bounce, go stale or
 * be replaced — so choosing a cheque method here posts to the same outbound
 * issuance endpoint the Treasury desk's Issue Outbound Cheque form uses. That
 * creates the cheque_records row the Treasury desk needs, puts the cheque in the
 * print queue, and leaves the bill's balance untouched until the cheque clears.
 * The API decides which methods are cheque methods and flags them
 * `requires_cheque_instrument`; it also withholds them from anyone who cannot
 * issue a cheque, so nothing here needs its own permission check.
 *
 * The settlement date is the day the money actually left, which is often before
 * today — the usual case is a payment nobody got around to recording. Once
 * saved, correcting it requires the transaction:change_date permission and a
 * written reason, via ChangeTransactionDateModal. A cheque has no settlement
 * date to record; it has a cheque date, which may be in the future (a PDC).
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
    const isCheque = Boolean(selectedMethod?.requires_cheque_instrument);
    const referenceLabel = isCheque ? 'Reference Number' : (methodConfig.reference_label || 'Reference Number');
    // The cheque's own number is captured in its dedicated field below, so the
    // method's "Cheque Number" reference requirement is already satisfied.
    const referenceRequired = !isCheque && Boolean(methodConfig.requires_reference);
    // A bank-type method moved money out of one of our accounts, so knowing
    // which one is what makes the payment reconcilable against a statement. For a
    // cheque it is not optional: it is the account the cheque is drawn on, and it
    // determines both the cheque-number sequence and the print template.
    const showBankAccount = isCheque || selectedMethod?.type === 'bank' || selectedMethod?.type === 'mobile';

    const supplierName = presetSupplier?.supplier_name
        || suppliers.find(s => String(s.supplier_id) === String(supplierId))?.supplier_name
        || '';

    // Suggest the next physical cheque number for the chosen account — freely
    // editable, since the paper cheque book is the real sequence. Mirrors
    // IssueOutboundChequeModal so both entry points suggest the same number.
    const chequeBankAccountId = isCheque ? form.bank_account_id : '';
    useEffect(() => {
        if (!chequeBankAccountId) return;
        let cancelled = false;
        api.get('/ap/cheque-register/next-number', { params: { bank_account_id: chequeBankAccountId } })
            .then(res => {
                const next = res.data?.data?.next_cheque_number;
                if (!cancelled) setForm(prev => ({ ...prev, cheque_number: next || '' }));
            })
            .catch(() => { /* only a suggestion — the field stays typeable */ });
        return () => { cancelled = true; };
    }, [chequeBankAccountId]);

    const selectedBankAccount = bankAccounts.find(
        a => String(a.bank_account_id) === String(form.bank_account_id)
    );

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

    const explicitAllocations = () => Object.entries(allocations)
        .map(([bill_id, value]) => ({ bill_id: Number(bill_id), amount: parseFloat(value) }))
        .filter(a => a.amount > 0);

    const submitCheque = async (amount) => {
        const res = await api.post('/ap/outbound-clearance/issue', {
            bank_account_id: form.bank_account_id,
            cheque_number: form.cheque_number.trim(),
            cheque_date: form.cheque_date,
            purpose_type: 'SUPPLIER_PAYMENT',
            amount,
            payee: supplierName,
            memo: form.notes.trim() || undefined,
            reference_number: form.reference_number.trim() || undefined,
            supplier_id: form.supplier_id,
            method_id: form.method_id,
            auto_allocate: autoAllocate,
            allocations: autoAllocate ? undefined : explicitAllocations(),
        });
        const { templateId } = res.data || {};
        if (templateId) {
            toast.success('Cheque issued and added to the Print Cheques queue.', { icon: '🖨️' });
        } else {
            toast.success('Cheque issued.', { icon: '✓' });
            toast('No print template is linked to this bank account yet — link one in Bank Accounts before printing.', { icon: 'ℹ️' });
        }
        toast('The bill balance updates when the cheque clears, from Outbound Cheques & Treasury.', { icon: 'ℹ️' });
    };

    const submitDirect = async (amount) => {
        const payload = {
            supplier_id: form.supplier_id,
            method_id: form.method_id,
            amount,
            settlement_date: form.settlement_date || undefined,
            reference_number: form.reference_number.trim() || undefined,
            bank_account_id: showBankAccount ? (form.bank_account_id || undefined) : undefined,
            notes: form.notes.trim() || undefined,
        };
        if (!autoAllocate) payload.allocations = explicitAllocations();

        const res = await api.post('/ap/payments', payload);
        const applied = res.data?.data?.allocations?.length || 0;
        toast.success(`Payment recorded against ${applied} bill${applied === 1 ? '' : 's'}`);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const amount = typeof form.amount === 'number' ? form.amount : parseFloat(form.amount);
        if (!form.supplier_id) { toast.error('Select a supplier'); return; }
        if (!form.method_id) { toast.error('Select a payment method'); return; }
        if (!amount || amount <= 0) { toast.error('Enter a valid payment amount'); return; }
        if (referenceRequired && !form.reference_number.trim()) {
            toast.error(`${referenceLabel} is required for ${selectedMethod.name} payments`);
            return;
        }
        if (isCheque) {
            if (!form.bank_account_id) { toast.error('Select the bank account the cheque is drawn on'); return; }
            if (!form.cheque_number.trim()) { toast.error('Enter the cheque number'); return; }
            if (!form.cheque_date) { toast.error('Enter the cheque date'); return; }
            if (!supplierName) { toast.error('The supplier name is needed as the payee'); return; }
        } else if (form.settlement_date > today()) {
            toast.error('Settlement date cannot be in the future');
            return;
        }
        if (!autoAllocate && Math.abs(allocatedTotal - amount) > 0.005) {
            toast.error('Allocations must add up to the payment amount');
            return;
        }

        setSaving(true);
        try {
            if (isCheque) await submitCheque(amount);
            else await submitDirect(amount);
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
                                Cash, bank transfer and e-wallet payments are recorded as already settled. A cheque is issued instead: it goes on the Outbound Cheques &amp; Treasury desk with its own lifecycle, so it can be cleared, bounced or replaced later.
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
                        <MathExpressionInput
                            precision={2}
                            min={0}
                            required
                            value={form.amount}
                            onChange={(val) => handleChange('amount', val)}
                            className={inputClass}
                        />
                        {supplierId && (
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Outstanding: {formatCurrency(totalOutstanding)}
                            </p>
                        )}
                    </div>
                    {isCheque ? (
                        <div>
                            <label className={labelClass + ' flex items-center gap-1'}>
                                Cheque Date
                                <InfoTip label="Cheque Date">
                                    The date written on the cheque. A future date makes it a post-dated cheque — it stays on the Treasury desk until it matures, and the bill balance only moves when it clears.
                                </InfoTip>
                            </label>
                            <input type="date" value={form.cheque_date}
                                onChange={(e) => handleChange('cheque_date', e.target.value)} className={inputClass} />
                        </div>
                    ) : (
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
                    )}
                </div>

                {isCheque && (
                    <div className="border border-primary-200 dark:border-primary-900/50 bg-primary-50/50 dark:bg-primary-900/10 rounded-lg p-3 space-y-3">
                        <p className="text-xs text-gray-600 dark:text-slate-400">
                            This cheque is issued to <span className="font-medium text-gray-800 dark:text-slate-200">{supplierName || 'the selected supplier'}</span> and
                            tracked on the Outbound Cheques &amp; Treasury desk. The bill balance does not change until the cheque clears.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className={labelClass}>
                                    Bank Account<span className="text-danger-600"> *</span>
                                </label>
                                <select value={form.bank_account_id} onChange={(e) => handleChange('bank_account_id', e.target.value)}
                                    className={inputClass} required>
                                    <option value="">Select account…</option>
                                    {bankAccounts.map(a => (
                                        <option key={a.bank_account_id} value={a.bank_account_id}>
                                            {a.account_name} — {a.bank_name}
                                        </option>
                                    ))}
                                </select>
                                {selectedBankAccount && (
                                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                        {selectedBankAccount.default_cheque_template_id
                                            ? '✓ Has a print template — ready to print from Print Cheques'
                                            : 'No print template linked — set one in Bank Accounts before printing'}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className={labelClass + ' flex items-center gap-1'}>
                                    Cheque Number<span className="text-danger-600"> *</span>
                                    <InfoTip label="Cheque Number">
                                        Suggested automatically from the bank account's sequence, but always freely editable — the physical cheque book is the real source of truth.
                                    </InfoTip>
                                </label>
                                <input type="text" value={form.cheque_number} required
                                    onChange={(e) => handleChange('cheque_number', e.target.value)}
                                    placeholder="e.g. 0001234"
                                    className={`${inputClass} font-mono`} />
                            </div>
                        </div>
                    </div>
                )}

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
                        {showBankAccount && !isCheque && (
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
                                {isCheque ? 'The cheque will be applied to the' : 'The payment will be applied to the'} {bills.length} open
                                bill{bills.length === 1 ? '' : 's'} in due-date order
                                {isCheque ? ', taking effect when it clears.' : '.'}
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
                                                    {(bill.related_grns || []).length > 0
                                                        ? ` · ${bill.related_grns.map(g => g.grn_number).join(', ')}`
                                                        : ''}
                                                </p>
                                            </div>
                                            <MathExpressionInput
                                                precision={2}
                                                min={0}
                                                max={outstandingOf(bill)}
                                                value={allocations[bill.bill_id] || ''}
                                                onChange={(val) => setAllocations(prev => ({ ...prev, [bill.bill_id]: val }))}
                                                placeholder="0.00"
                                                className="w-32 px-2 py-1 text-sm text-right border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md"
                                            />
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
                    <label className={labelClass}>{isCheque ? 'Memo' : 'Notes'}</label>
                    <textarea value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} rows={2} className={inputClass} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                    <button type="submit" disabled={saving || bills.length === 0} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                        {saving ? (isCheque ? 'Issuing…' : 'Recording...') : (isCheque ? 'Issue Cheque' : 'Record Payment')}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default RecordSupplierPaymentModal;
