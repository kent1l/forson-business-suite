import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';

const STATUS_TABS = [
    { key: 'pending', label: 'Needs Review' },
    { key: 'approved', label: 'Active Terms' },
    { key: 'rejected', label: 'Ignored' }
];

const TARGET_LABELS = {
    category: 'Category',
    payee: 'Payee',
    payment_method: 'Payment Method'
};

export default function ExpenseLexiconPage() {
    const [status, setStatus] = useState('pending');
    const [entries, setEntries] = useState([]);
    const [categories, setCategories] = useState([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editCategoryId, setEditCategoryId] = useState('');

    useEffect(() => {
        api.get('/expense-categories')
            .then(res => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    const fetchEntries = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, countRes] = await Promise.all([
                api.get('/expense-lexicon', { params: { status } }),
                api.get('/expense-lexicon/pending-count')
            ]);
            setEntries(listRes.data || []);
            setPendingCount(countRes.data?.pending || 0);
        } catch (error) {
            console.error('Error loading expense lexicon:', error);
            toast.error('Failed to load learned terms');
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => { fetchEntries(); }, [fetchEntries]);

    const handleReview = async (aliasId, newStatus) => {
        setBusyId(aliasId);
        try {
            await api.put(`/expense-lexicon/${aliasId}/review`, { status: newStatus });
            toast.success(newStatus === 'approved' ? 'Term is now active' : 'Term will be ignored');
            fetchEntries();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update term');
        } finally {
            setBusyId(null);
        }
    };

    const handleSaveCategory = async (entry) => {
        if (!editCategoryId) {
            toast.error('Choose a category first');
            return;
        }
        setBusyId(entry.alias_id);
        try {
            await api.put(`/expense-lexicon/${entry.alias_id}`, {
                term: entry.term,
                target_type: 'category',
                category_id: parseInt(editCategoryId, 10)
            });
            toast.success('Term updated');
            setEditingId(null);
            fetchEntries();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update term');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (aliasId) => {
        setBusyId(aliasId);
        try {
            await api.delete(`/expense-lexicon/${aliasId}`);
            toast.success('Term removed');
            fetchEntries();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to remove term');
        } finally {
            setBusyId(null);
        }
    };

    const meaningOf = (entry) => {
        if (entry.target_type === 'category') return entry.category_name || '(missing category)';
        if (entry.target_type === 'payee') return entry.payee || '(missing payee)';
        return entry.payment_method_name || '(missing payment method)';
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                    <Icon path={ICONS.star} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                    <span>Learned Expense Terms</span>
                    <InfoTip label="Learned Expense Terms">
                        Approving, ignoring, or correcting a term here never changes any expense already recorded — it only affects how future Quick Entry text gets interpreted.
                    </InfoTip>
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
                    When staff record expenses in everyday language, the system collects the words they use
                    and suggests what each one means. Nothing here affects expense entry until you approve it.
                </p>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700">
                {STATUS_TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setStatus(tab.key)}
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                            status === tab.key
                                ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                    >
                        {tab.label}
                        {tab.key === 'pending' && pendingCount > 0 && (
                            <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-900/50">
                                {pendingCount}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Loading learned terms...</div>
                ) : entries.length === 0 ? (
                    <div className="py-16 text-center">
                        <Icon path={ICONS.star} className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                        <p className="font-medium text-slate-600 dark:text-slate-300">
                            {status === 'pending' ? 'Nothing to review right now' : 'No terms here yet'}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {status === 'pending'
                                ? 'New words will appear here as staff record expenses.'
                                : 'Approve a suggested term to see it listed here.'}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                        {entries.map(entry => (
                            <li key={entry.alias_id} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-700/40 transition-colors">
                                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center flex-wrap gap-2">
                                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                                                {entry.term}
                                            </span>
                                            <span className="text-slate-400 dark:text-slate-500 text-xs">means</span>

                                            {editingId === entry.alias_id ? (
                                                <select
                                                    value={editCategoryId}
                                                    onChange={(e) => setEditCategoryId(e.target.value)}
                                                    className="px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                                >
                                                    <option value="">-- Choose category --</option>
                                                    {categories.map(c => (
                                                        <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="font-semibold text-primary-700 dark:text-primary-400 text-sm">{meaningOf(entry)}</span>
                                            )}

                                            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
                                                {TARGET_LABELS[entry.target_type] || entry.target_type}
                                            </span>
                                            {entry.language_hint === 'ceb' && (
                                                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-900/50 rounded px-1.5 py-0.5">
                                                    Bisaya
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                                            Seen <span className="font-semibold text-slate-700 dark:text-slate-300">{entry.confirm_count}×</span>
                                            {entry.example_input && (
                                                <> · from “<span className="italic">{entry.example_input}</span>”</>
                                            )}
                                        </p>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {editingId === entry.alias_id ? (
                                            <>
                                                <button
                                                    onClick={() => handleSaveCategory(entry)}
                                                    disabled={busyId === entry.alias_id}
                                                    className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 cursor-pointer transition-colors shadow-xs"
                                                >
                                                    Save
                                                </button>
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                {entry.target_type === 'category' && (
                                                    <button
                                                        onClick={() => {
                                                            setEditingId(entry.alias_id);
                                                            setEditCategoryId(String(entry.category_id || ''));
                                                        }}
                                                        title="Change what this term means"
                                                        className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded transition-colors cursor-pointer"
                                                    >
                                                        <Icon path={ICONS.edit} className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {entry.status !== 'approved' && (
                                                    <button
                                                        onClick={() => handleReview(entry.alias_id, 'approved')}
                                                        disabled={busyId === entry.alias_id}
                                                        className="px-3 py-1.5 text-xs font-semibold text-white bg-success-600 hover:bg-success-700 rounded-lg disabled:opacity-50 cursor-pointer transition-colors shadow-xs"
                                                    >
                                                        Use this
                                                    </button>
                                                )}
                                                {entry.status !== 'rejected' && (
                                                    <button
                                                        onClick={() => handleReview(entry.alias_id, 'rejected')}
                                                        disabled={busyId === entry.alias_id}
                                                        className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg disabled:opacity-50 cursor-pointer transition-colors"
                                                    >
                                                        Ignore
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(entry.alias_id)}
                                                    disabled={busyId === entry.alias_id}
                                                    title="Remove this term entirely"
                                                    className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 rounded transition-colors cursor-pointer"
                                                >
                                                    <Icon path={ICONS.trash} className="w-4 h-4" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
