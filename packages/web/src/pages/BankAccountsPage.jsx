import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';

const emptyForm = { account_name: '', bank_name: '', account_number: '', currency: 'PHP', opening_balance: '0', notes: '', default_cheque_template_id: '' };

const LABEL_CLASS = 'block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1';
const INPUT_CLASS = 'w-full text-xs p-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const BankAccountsPage = () => {
    const { hasPermission } = useAuth();
    const canManage = hasPermission('ap-pdc:manage');

    const [accounts, setAccounts] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [submitting, setSubmitting] = useState(false);

    const fetchAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/bank-accounts');
            setAccounts(res.data?.data || []);
        } catch (err) {
            console.error('Error fetching bank accounts:', err);
            toast.error('Failed to load bank accounts');
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchTemplates = useCallback(async () => {
        try {
            const res = await api.get('/cheques/templates');
            setTemplates(res.data || []);
        } catch (err) {
            // Not fatal — the account can still be created without a linked print template.
            console.error('Error fetching cheque templates:', err);
        }
    }, []);

    useEffect(() => { fetchAccounts(); fetchTemplates(); }, [fetchAccounts, fetchTemplates]);

    const templateName = (id) => templates.find(t => String(t.id) === String(id))?.bank_name;

    const openCreate = () => { setEditingId(null); setForm(emptyForm); setModalOpen(true); };
    const openEdit = (acc) => {
        setEditingId(acc.bank_account_id);
        setForm({
            account_name: acc.account_name, bank_name: acc.bank_name, account_number: acc.account_number || '',
            default_cheque_template_id: acc.default_cheque_template_id || '',
            currency: acc.currency, opening_balance: String(acc.opening_balance), notes: acc.notes || '',
        });
        setModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.account_name || !form.bank_name) {
            toast.error('Account name and bank name are required');
            return;
        }
        setSubmitting(true);
        try {
            const payload = { ...form, opening_balance: parseFloat(form.opening_balance) || 0 };
            if (editingId) {
                await api.put(`/bank-accounts/${editingId}`, payload);
                toast.success('Bank account updated');
            } else {
                await api.post('/bank-accounts', payload);
                toast.success('Bank account created');
            }
            setModalOpen(false);
            fetchAccounts();
        } catch (err) {
            console.error('Error saving bank account:', err);
            toast.error(err.response?.data?.message || 'Failed to save bank account');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleActive = async (acc) => {
        try {
            await api.put(`/bank-accounts/${acc.bank_account_id}`, { is_active: !acc.is_active });
            fetchAccounts();
        } catch (err) {
            toast.error('Failed to update account status');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Bank Accounts</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">The business's own bank accounts, used for issuing and reconciling outbound cheques</p>
                </div>
                {canManage && (
                    <button onClick={openCreate} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold shadow-xs cursor-pointer">
                        + New Bank Account
                    </button>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left text-gray-500 dark:text-slate-400">
                    <thead className="text-xs text-gray-700 dark:text-slate-300 uppercase bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
                        <tr>
                            <th className="px-6 py-3.5">Account Name</th>
                            <th className="px-6 py-3.5">Bank</th>
                            <th className="px-6 py-3.5">Account #</th>
                            <th className="px-6 py-3.5 text-right">Opening Balance</th>
                            <th className="px-6 py-3.5">Print Template</th>
                            <th className="px-6 py-3.5">Status</th>
                            {canManage && <th className="px-6 py-3.5 text-center">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                        {loading ? (
                            [...Array(3)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td colSpan={7} className="px-6 py-4">
                                        <div className="h-4 bg-gray-100 dark:bg-slate-700 rounded w-full" />
                                    </td>
                                </tr>
                            ))
                        ) : accounts.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <span className="text-2xl">🏦</span>
                                        <p className="font-semibold text-gray-700 dark:text-slate-300">No bank accounts yet</p>
                                        <p className="text-xs text-gray-400 dark:text-slate-500">
                                            {canManage ? 'Add one to start issuing and receiving cheques.' : 'Ask an administrator to add one.'}
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ) : accounts.map(acc => (
                            <tr key={acc.bank_account_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                <td className="px-6 py-4 font-semibold text-gray-900 dark:text-slate-100">{acc.account_name}</td>
                                <td className="px-6 py-4">{acc.bank_name}</td>
                                <td className="px-6 py-4 font-mono">{acc.account_number || '—'}</td>
                                <td className="px-6 py-4 text-right font-mono">{formatCurrency(acc.opening_balance)}</td>
                                <td className="px-6 py-4 text-xs">
                                    {acc.default_cheque_template_id ? (
                                        <span className="px-2 py-0.5 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 rounded-md border border-primary-200 dark:border-primary-900/40">{templateName(acc.default_cheque_template_id) || `#${acc.default_cheque_template_id}`}</span>
                                    ) : (
                                        <span className="text-gray-400 dark:text-slate-500">Not linked (manual print)</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <StatusBadge tone={acc.is_active ? 'success' : 'neutral'} label={acc.is_active ? 'Active' : 'Inactive'} />
                                </td>
                                {canManage && (
                                    <td className="px-6 py-4 text-center whitespace-nowrap">
                                        <button onClick={() => openEdit(acc)} className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline mr-3 cursor-pointer">Edit</button>
                                        <button onClick={() => toggleActive(acc)} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:underline cursor-pointer">
                                            {acc.is_active ? 'Deactivate' : 'Activate'}
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Bank Account' : 'New Bank Account'}>
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className={LABEL_CLASS}>Account Name</label>
                        <input type="text" value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                            className={INPUT_CLASS} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Bank Name</label>
                        <input type="text" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                            className={INPUT_CLASS} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Account Number</label>
                        <input type="text" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                            className={`${INPUT_CLASS} font-mono`} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={LABEL_CLASS}>Currency</label>
                            <input type="text" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                                className={INPUT_CLASS} />
                        </div>
                        <div>
                            <label className={LABEL_CLASS}>Opening Balance</label>
                            <input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                                className={`${INPUT_CLASS} font-mono`} />
                        </div>
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Default Cheque Print Template</label>
                        <select value={form.default_cheque_template_id} onChange={(e) => setForm({ ...form, default_cheque_template_id: e.target.value })}
                            className={INPUT_CLASS}>
                            <option value="">None — print manually from Cheque Printing</option>
                            {templates.map(t => (
                                <option key={t.id} value={t.id}>{t.bank_name}</option>
                            ))}
                        </select>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">When set, issuing a cheque from this account auto-generates and opens the printable PDF.</p>
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Notes</label>
                        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            className={INPUT_CLASS} rows={2} />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer">Cancel</button>
                        <button type="submit" disabled={submitting} className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50">
                            {submitting ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default BankAccountsPage;
