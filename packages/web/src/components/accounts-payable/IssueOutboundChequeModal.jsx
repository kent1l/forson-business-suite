import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';

const PURPOSE_OPTIONS = [
    { value: 'SUPPLIER_PAYMENT', label: 'Supplier Bill Payment' },
    { value: 'LOAN_PAYMENT', label: 'Loan Payment' },
    { value: 'RENT', label: 'Rent' },
    { value: 'OTHER_EXPENSE', label: 'Other Expense' },
];

const LABEL_CLASS = 'block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1';
const INPUT_CLASS = 'w-full text-xs p-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const IssueOutboundChequeModal = ({ isOpen, onClose, onIssued }) => {
    const [bankAccounts, setBankAccounts] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [supplierBills, setSupplierBills] = useState([]);

    const [form, setForm] = useState({
        bank_account_id: '', cheque_number: '', cheque_date: '', purpose_type: 'SUPPLIER_PAYMENT',
        amount: '', payee: '', memo: '', reference_number: '',
        supplier_id: '', bill_ids: [], expense_category_id: '',
    });
    const [submitting, setSubmitting] = useState(false);

    const resetForm = useCallback(() => {
        setForm({
            bank_account_id: '', cheque_number: '', cheque_date: '', purpose_type: 'SUPPLIER_PAYMENT',
            amount: '', payee: '', memo: '', reference_number: '',
            supplier_id: '', bill_ids: [], expense_category_id: '',
        });
        setSupplierBills([]);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        resetForm();
        (async () => {
            try {
                const [baRes, supRes, catRes] = await Promise.all([
                    api.get('/bank-accounts'),
                    api.get('/suppliers'),
                    api.get('/expense-categories'),
                ]);
                setBankAccounts(baRes.data?.data || baRes.data || []);
                setSuppliers(supRes.data?.data || supRes.data || []);
                setCategories(catRes.data?.data || catRes.data || []);
            } catch (err) {
                console.error('Error loading issuance form data:', err);
            }
        })();
    }, [isOpen, resetForm]);

    useEffect(() => {
        if (form.purpose_type !== 'SUPPLIER_PAYMENT' || !form.supplier_id) {
            setSupplierBills([]);
            return;
        }
        (async () => {
            try {
                const res = await api.get('/ap/supplier-bills', { params: { supplier_id: form.supplier_id } });
                setSupplierBills(res.data?.data || []);
            } catch (err) {
                console.error('Error loading supplier bills:', err);
            }
        })();
    }, [form.purpose_type, form.supplier_id]);

    // Suggest the next physical cheque number for the selected bank account —
    // still freely editable, since the real sequence lives on the paper book.
    useEffect(() => {
        if (!form.bank_account_id || form.cheque_number) return;
        (async () => {
            try {
                const res = await api.get('/ap/cheque-register/next-number', { params: { bank_account_id: form.bank_account_id } });
                const next = res.data?.data?.next_cheque_number;
                if (next) setForm(prev => (prev.cheque_number ? prev : { ...prev, cheque_number: next }));
            } catch (err) {
                console.error('Error suggesting next cheque number:', err);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.bank_account_id]);

    const selectedSupplier = suppliers.find(s => String(s.supplier_id) === String(form.supplier_id));
    const selectedBankAccount = bankAccounts.find(ba => String(ba.bank_account_id) === String(form.bank_account_id));

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const toggleBill = (billId) => {
        setForm(prev => ({
            ...prev,
            bill_ids: prev.bill_ids.includes(billId)
                ? prev.bill_ids.filter(id => id !== billId)
                : [...prev.bill_ids, billId],
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.bank_account_id || !form.cheque_number || !form.cheque_date || !form.amount) {
            toast.error('Bank account, cheque number, cheque date, and amount are required');
            return;
        }
        if (form.purpose_type === 'SUPPLIER_PAYMENT' && !form.supplier_id) {
            toast.error('Select a supplier for a supplier payment cheque');
            return;
        }
        if (form.purpose_type !== 'SUPPLIER_PAYMENT' && !form.expense_category_id) {
            toast.error('Select an expense category for this cheque');
            return;
        }

        const payee = form.purpose_type === 'SUPPLIER_PAYMENT'
            ? (selectedSupplier?.supplier_name || form.payee)
            : form.payee;
        if (!payee) {
            toast.error('Payee is required');
            return;
        }

        setSubmitting(true);
        try {
            const res = await api.post('/ap/outbound-clearance/issue', {
                bank_account_id: form.bank_account_id,
                cheque_number: form.cheque_number,
                cheque_date: form.cheque_date,
                purpose_type: form.purpose_type,
                amount: parseFloat(form.amount),
                payee,
                memo: form.memo,
                reference_number: form.reference_number,
                supplier_id: form.purpose_type === 'SUPPLIER_PAYMENT' ? form.supplier_id : undefined,
                bill_ids: form.purpose_type === 'SUPPLIER_PAYMENT' ? form.bill_ids : undefined,
                expense_category_id: form.purpose_type !== 'SUPPLIER_PAYMENT' ? form.expense_category_id : undefined,
            });
            const { chequeRecordId, templateId } = res.data || {};
            if (chequeRecordId && templateId) {
                toast.success('Outbound cheque issued and added to the Print Cheques queue.', { icon: '🖨️' });
            } else if (chequeRecordId) {
                toast.success('Outbound cheque issued.', { icon: '✓' });
                toast('No print template linked to this bank account yet — link one in Bank Accounts before printing from Print Cheques.', { icon: 'ℹ️' });
            } else {
                toast.success('Outbound cheque issued');
            }

            onIssued && onIssued();
            onClose();
        } catch (err) {
            console.error('Error issuing outbound cheque:', err);
            toast.error(err.response?.data?.message || 'Failed to issue outbound cheque');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Issue Outbound Cheque">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL_CLASS}>Bank Account</label>
                        <select value={form.bank_account_id} onChange={(e) => handleChange('bank_account_id', e.target.value)}
                            className={INPUT_CLASS}>
                            <option value="">Select account…</option>
                            {bankAccounts.map(ba => (
                                <option key={ba.bank_account_id} value={ba.bank_account_id}>{ba.account_name} — {ba.bank_name}</option>
                            ))}
                        </select>
                        {selectedBankAccount && (
                            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                                {selectedBankAccount.default_cheque_template_id
                                    ? '✓ Has a print template — ready to print from Print Cheques'
                                    : 'No print template linked — set one in Bank Accounts before printing'}
                            </p>
                        )}
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Cheque Number</label>
                        <input type="text" value={form.cheque_number} onChange={(e) => handleChange('cheque_number', e.target.value)}
                            className={`${INPUT_CLASS} font-mono`} placeholder="e.g. 0001234" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL_CLASS}>Cheque Date</label>
                        <input type="date" value={form.cheque_date} onChange={(e) => handleChange('cheque_date', e.target.value)}
                            className={INPUT_CLASS} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Amount (₱)</label>
                        <input type="number" step="0.01" value={form.amount} onChange={(e) => handleChange('amount', e.target.value)}
                            className={`${INPUT_CLASS} font-mono`} />
                    </div>
                </div>

                <div>
                    <label className={LABEL_CLASS}>Purpose</label>
                    <div className="flex flex-wrap gap-2">
                        {PURPOSE_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleChange('purpose_type', opt.value)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                                    form.purpose_type === opt.value
                                        ? 'bg-primary-600 text-white border-primary-600'
                                        : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700'
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {form.purpose_type === 'SUPPLIER_PAYMENT' ? (
                    <>
                        <div>
                            <label className={LABEL_CLASS}>Supplier</label>
                            <select value={form.supplier_id} onChange={(e) => handleChange('supplier_id', e.target.value)}
                                className={INPUT_CLASS}>
                                <option value="">Select supplier…</option>
                                {suppliers.map(s => (
                                    <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                                ))}
                            </select>
                        </div>
                        {supplierBills.length > 0 && (
                            <div>
                                <label className={LABEL_CLASS}>Apply to Bills (optional)</label>
                                <div className="max-h-32 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700">
                                    {supplierBills.map(bill => (
                                        <label key={bill.bill_id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300">
                                            <input type="checkbox" checked={form.bill_ids.includes(bill.bill_id)} onChange={() => toggleBill(bill.bill_id)} />
                                            <span className="font-mono">{bill.bill_number || `#${bill.bill_id}`}</span>
                                            <span className="text-gray-400 dark:text-slate-500 flex-1">
                                                Owed: ₱{(parseFloat(bill.total_amount) - parseFloat(bill.amount_paid)).toFixed(2)}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <div>
                            <label className={LABEL_CLASS}>Expense Category</label>
                            <select value={form.expense_category_id} onChange={(e) => handleChange('expense_category_id', e.target.value)}
                                className={INPUT_CLASS}>
                                <option value="">Select category…</option>
                                {categories.map(c => (
                                    <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={LABEL_CLASS}>Payee</label>
                            <input type="text" value={form.payee} onChange={(e) => handleChange('payee', e.target.value)}
                                className={INPUT_CLASS} />
                        </div>
                    </>
                )}

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL_CLASS}>Reference # (optional)</label>
                        <input type="text" value={form.reference_number} onChange={(e) => handleChange('reference_number', e.target.value)}
                            className={INPUT_CLASS} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Memo (optional)</label>
                        <input type="text" value={form.memo} onChange={(e) => handleChange('memo', e.target.value)}
                            className={INPUT_CLASS} />
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer">
                        Cancel
                    </button>
                    <button type="submit" disabled={submitting} className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                        {submitting ? 'Issuing…' : 'Issue Cheque'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default IssueOutboundChequeModal;
