import { useEffect, useState } from 'react';
import api from '../../api';

export default function NotebookCoverageFields({ amount, receiptId, coveredAmount, onChange, disabled = false }) {
    const [receipts, setReceipts] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        api.get('/cash-drawers/notebook-receipts')
            .then(response => { if (live) setReceipts(response.data?.data || []); })
            .catch(err => { if (live && err.response?.status !== 503) setError('Notebook receipts could not be loaded.'); });
        return () => { live = false; };
    }, []);

    if (!receipts.length && !receiptId && !error) return null;
    const selected = receipts.find(row => String(row.movement_id) === String(receiptId));
    const covered = Number(coveredAmount) || 0;
    const due = Number(amount) || 0;
    const invalid = !!receiptId && (!selected || covered <= 0 || covered > Number(selected.available_amount) || covered > due);
    return <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-slate-100">
        <label className="block font-semibold" htmlFor={`notebook-${receiptId || 'none'}`}>Earlier notebook cash receipt</label>
        <select id={`notebook-${receiptId || 'none'}`} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            disabled={disabled} value={receiptId || ''} onChange={event => onChange(event.target.value, '')}>
            <option value="">No earlier cash received</option>
            {receipts.map(row => <option key={row.movement_id} value={row.movement_id}>
                {row.drawer_name} · {row.business_date?.slice(0, 10)} · #{row.sequence} · {row.physical_reference || row.description} · ₱{Number(row.available_amount).toFixed(2)} available
            </option>)}
        </select>
        {receiptId && <>
            <label className="mt-2 block font-semibold">Amount already in the cash box
                <input type="number" min="0.01" step="0.01" max={Math.min(due, Number(selected?.available_amount || 0))} required disabled={disabled}
                    className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                    value={coveredAmount} onChange={event => onChange(receiptId, event.target.value)} />
            </label>
            <p className="mt-2 font-semibold">New cash to post: ₱{Math.max(0, due - covered).toFixed(2)}</p>
            {invalid && <p role="alert" className="text-red-700">Enter coverage above zero, no more than this payment or the receipt’s available amount.</p>}
        </>}
        {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
    </div>;
}
