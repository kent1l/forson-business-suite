import { useEffect, useState } from 'react';
import api from '../../api';

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : '—');

/**
 * Read-only list of prior date corrections for a transaction, sourced from
 * transaction_date_change_log via GET /transaction-date/:kind/:id/history.
 * Renders nothing if the transaction has never had its date changed.
 */
const TransactionDateHistory = ({ kind, id }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!kind || !id) return;
        let cancelled = false;
        setLoading(true);
        api.get(`/transaction-date/${kind}/${id}/history`)
            .then((res) => { if (!cancelled) setRows(res.data || []); })
            .catch(() => { if (!cancelled) setRows([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [kind, id]);

    if (loading || rows.length === 0) return null;

    return (
        <div className="mt-4 border-t border-gray-200 dark:border-slate-700 pt-3">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Date Change History</p>
            <ul className="space-y-2">
                {rows.map((r) => (
                    <li key={r.log_id} className="text-sm text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
                        <div className="flex justify-between">
                            <span>{fmtDateTime(r.old_date)} → {fmtDateTime(r.new_date)}</span>
                            <span className="text-xs text-gray-400 dark:text-slate-500">{fmtDateTime(r.changed_on)}</span>
                        </div>
                        <div className="text-xs italic mt-1">{r.reason}</div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default TransactionDateHistory;
