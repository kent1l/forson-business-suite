import { supplierReference } from '../../utils/supplierReference';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/currency';
import ChangeTransactionDateModal from '../common/ChangeTransactionDateModal';
import ReplaceChequeModal from './ReplaceChequeModal';
import DeletePaymentModal from './DeletePaymentModal';

const CHANNELS = [
    { key: 'all', label: 'All' },
    { key: 'direct', label: 'Cash / Transfer / E-wallet' },
    { key: 'cheque', label: 'Cheques' },
];

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

/**
 * Every payment made to a supplier, whatever the method.
 */
const PaymentsRegisterTable = ({ refreshToken, focusPaymentId, onClearFocus, onDataMutated }) => {
    const { hasPermission } = useAuth();
    const canChangeDate = hasPermission('transaction:change_date') || hasPermission('transaction:change_date_unrestricted');
    const canManageCheque = hasPermission('ap-pdc:manage');
    const canDeletePayment = hasPermission('ap-pdc:delete') || hasPermission('ap:manage') || canManageCheque;

    const [payments, setPayments] = useState([]);
    const [channel, setChannel] = useState('all');
    const [includeHistory, setIncludeHistory] = useState(false);
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dateTarget, setDateTarget] = useState(null);
    const [replaceTarget, setReplaceTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    const fetchPayments = useCallback(() => {
        setLoading(true);
        api.get('/ap/payments', {
            params: {
                channel,
                payment_id: focusPaymentId || undefined,
                include_history: includeHistory ? 'true' : undefined,
                include_deleted: includeDeleted ? 'true' : undefined,
            },
        })
            .then(res => setPayments(res.data?.data || []))
            .catch(() => toast.error('Failed to load supplier payments'))
            .finally(() => setLoading(false));
    }, [channel, focusPaymentId, includeHistory, includeDeleted]);

    useEffect(() => { fetchPayments(); }, [fetchPayments, refreshToken]);

    const handleAfterMutation = () => {
        fetchPayments();
        if (onDataMutated) onDataMutated();
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xs">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 mr-auto">Payment Register</h3>
                {focusPaymentId && <button className="min-h-11 rounded border px-3 text-sm" onClick={onClearFocus}>Payment #{focusPaymentId} · clear filter</button>}
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeHistory}
                        onChange={(e) => setIncludeHistory(e.target.checked)}
                        className="rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span>Show replaced / voided</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-slate-300 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={includeDeleted}
                        onChange={(e) => setIncludeDeleted(e.target.checked)}
                        className="rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span>Include deleted</span>
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                    {CHANNELS.map(c => (
                        <button key={c.key} onClick={() => setChannel(c.key)}
                            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${channel === c.key
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs uppercase text-gray-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3">Settled / Cheque Date</th>
                            <th className="px-4 py-3">Supplier</th>
                            <th className="px-4 py-3">Method &amp; Status</th>
                            <th className="px-4 py-3">Reference / Cheque #</th>
                            <th className="px-4 py-3">Applied To</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3">Recorded By</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {loading && (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Loading…</td></tr>
                        )}
                        {!loading && payments.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">{focusPaymentId ? `Supplier payment #${focusPaymentId} is unavailable or you do not have access to it.` : 'No payments recorded yet.'}</td></tr>
                        )}
                        {!loading && payments.map(p => {
                            const isRetired = ['REPLACED', 'VOID', 'DELETED'].includes(p.pdc_status);
                            const canReplace = Boolean(p.cheque_record_id && canManageCheque && !['CLEARED', 'REPLACED', 'VOID', 'DELETED'].includes(p.pdc_status));
                            const canDelete = Boolean(canDeletePayment && ['ISSUED', 'HELD_FOR_RELEASE', 'STALE'].includes(p.pdc_status));
                            return (
                                <tr key={p.payment_id} className={`hover:bg-gray-50 dark:hover:bg-slate-700/40 ${isRetired ? 'opacity-65' : ''}`}>
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-slate-100">
                                        {fmtDate(p.cheque_date || p.payment_date)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{p.supplier_name}</td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                        <span>{p.method_name || '—'}</span>
                                        {(p.cheque_record_id || p.pdc_status !== 'CLEARED') && (
                                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                                                {p.pdc_status}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300 font-mono text-xs">
                                        <div className="flex flex-col gap-0.5">
                                            <span>{p.cheque_number ? `#${p.cheque_number}` : (p.reference_number || '—')}</span>
                                            {p.replaces_cheque_number && (
                                                <span className="text-[10px] font-sans text-primary-700 dark:text-primary-400">
                                                    ↳ Replaces #{p.replaces_cheque_number}
                                                </span>
                                            )}
                                            {p.replaced_by_cheque_number && (
                                                <span className="text-[10px] font-sans text-warning-700 dark:text-warning-400">
                                                    → Replaced by #{p.replaced_by_cheque_number}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                        {(p.bills || []).map(b => supplierReference(b)).join(', ') || '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">{formatCurrency(p.amount)}</td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{p.recorded_by_name || '—'}</td>
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <div className="flex justify-end items-center gap-2">
                                            {canChangeDate && !p.cheque_record_id && !isRetired && (
                                                <button onClick={() => setDateTarget(p)}
                                                    className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer">
                                                    Change date
                                                </button>
                                            )}
                                            {canReplace && (
                                                <button onClick={() => setReplaceTarget(p)}
                                                    className="px-2 py-1 text-xs font-semibold rounded bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 border border-warning-200 dark:border-warning-800 hover:bg-warning-100 cursor-pointer">
                                                    Replace
                                                </button>
                                            )}
                                            {canDelete && (
                                                <button onClick={() => setDeleteTarget(p)}
                                                    className="px-2 py-1 text-xs font-semibold rounded bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800 hover:bg-danger-100 cursor-pointer">
                                                    Delete
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <ChangeTransactionDateModal
                isOpen={!!dateTarget}
                onClose={() => setDateTarget(null)}
                kind="ap_payment"
                id={dateTarget?.payment_id}
                currentDate={dateTarget?.payment_date}
                transactionLabel={dateTarget ? `${dateTarget.supplier_name} — ${formatCurrency(dateTarget.amount)}` : ''}
                onApplied={() => { setDateTarget(null); handleAfterMutation(); }}
            />

            <ReplaceChequeModal
                isOpen={!!replaceTarget}
                onClose={() => setReplaceTarget(null)}
                chequeRecordId={replaceTarget?.cheque_record_id}
                apPaymentId={replaceTarget?.payment_id}
                initialData={replaceTarget}
                onReplaced={handleAfterMutation}
            />

            <DeletePaymentModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                chequeRecordId={deleteTarget?.cheque_record_id}
                apPaymentId={deleteTarget?.payment_id}
                initialData={deleteTarget}
                onDeleted={handleAfterMutation}
                onSwitchToReplace={deleteTarget?.cheque_record_id ? (target) => {
                    setDeleteTarget(null);
                    setReplaceTarget({ ...deleteTarget, ...target });
                } : undefined}
            />
        </div>
    );
};

export default PaymentsRegisterTable;
