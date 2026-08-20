import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency } from '../../utils/currency';
import ChangeTransactionDateModal from '../common/ChangeTransactionDateModal';

const CHANNELS = [
    { key: 'all', label: 'All' },
    { key: 'direct', label: 'Cash / Transfer / E-wallet' },
    { key: 'cheque', label: 'Cheques' },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

/**
 * Every payment made to a supplier, whatever the method. Cheque rows are shown
 * with their instrument status but are corrected from the Treasury desk; direct
 * payments have no instrument, so this register is the only place their
 * settlement date can be corrected.
 */
const PaymentsRegisterTable = ({ refreshToken }) => {
    const { hasPermission } = useAuth();
    const canChangeDate = hasPermission('transaction:change_date') || hasPermission('transaction:change_date_unrestricted');

    const [payments, setPayments] = useState([]);
    const [channel, setChannel] = useState('all');
    const [loading, setLoading] = useState(false);
    const [dateTarget, setDateTarget] = useState(null);

    const fetchPayments = useCallback(() => {
        setLoading(true);
        api.get('/ap/payments', { params: { channel } })
            .then(res => setPayments(res.data?.data || []))
            .catch(() => toast.error('Failed to load supplier payments'))
            .finally(() => setLoading(false));
    }, [channel]);

    useEffect(() => { fetchPayments(); }, [fetchPayments, refreshToken]);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xs">
            <div className="flex flex-wrap items-center gap-2 p-4 border-b border-gray-200 dark:border-slate-700">
                <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 mr-auto">Payment Register</h3>
                {CHANNELS.map(c => (
                    <button key={c.key} onClick={() => setChannel(c.key)}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${channel === c.key
                            ? 'bg-primary-600 text-white'
                            : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>
                        {c.label}
                    </button>
                ))}
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs uppercase text-gray-500 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-3">Settled</th>
                            <th className="px-4 py-3">Supplier</th>
                            <th className="px-4 py-3">Method</th>
                            <th className="px-4 py-3">Reference</th>
                            <th className="px-4 py-3">Applied To</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3">Recorded By</th>
                            <th className="px-4 py-3" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {loading && (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Loading…</td></tr>
                        )}
                        {!loading && payments.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No payments recorded yet.</td></tr>
                        )}
                        {!loading && payments.map(p => (
                            <tr key={p.payment_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-slate-100">{fmtDate(p.payment_date)}</td>
                                <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{p.supplier_name}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                    {p.method_name || '—'}
                                    {p.cheque_record_id && (
                                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                                            {p.pdc_status}
                                        </span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{p.reference_number || '—'}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                                    {(p.bills || []).map(b => b.bill_number || `#${b.bill_id}`).join(', ') || '—'}
                                </td>
                                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">{formatCurrency(p.amount)}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{p.recorded_by_name || '—'}</td>
                                <td className="px-4 py-3 text-right">
                                    {canChangeDate && !p.cheque_record_id && (
                                        <button onClick={() => setDateTarget(p)}
                                            className="text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
                                            Change date
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
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
                onApplied={() => { setDateTarget(null); fetchPayments(); }}
            />
        </div>
    );
};

export default PaymentsRegisterTable;
