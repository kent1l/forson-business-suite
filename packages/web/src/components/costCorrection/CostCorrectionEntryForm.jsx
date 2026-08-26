import { useState, useMemo } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const blankEntry = () => ({ date_received: '', quantity: '', unit_cost: '', source_reference: '' });

/**
 * Captures the goods receipts an encoder can document for one part.
 *
 * Multiple dated rows are the point rather than a convenience: the system replays
 * receipts chronologically to derive the weighted average, so three real receipts
 * produce a true historical average where one lump-sum guess only approximates it.
 * The average itself is never entered here — it is computed from these rows.
 */
const CostCorrectionEntryForm = ({ detail, currency = '₱', onSaved }) => {
    const existing = detail.entries || [];
    const [entries, setEntries] = useState(
        existing.length
            ? existing.map(e => ({
                date_received: new Date(e.date_received).toISOString().slice(0, 10),
                quantity: String(e.quantity),
                unit_cost: String(e.unit_cost),
                source_reference: e.source_reference || '',
            }))
            : [blankEntry()]
    );
    const [gapUnitCost, setGapUnitCost] = useState(detail.line?.gap_unit_cost || '');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    const proposedQty = useMemo(
        () => entries.reduce((sum, e) => sum + (parseFloat(e.quantity) || 0), 0),
        [entries]
    );
    const projectedQty = detail.currentQty + proposedQty;

    // A counted quantity is only a valid target when the count actually saw these
    // receipts. The server decides that (it compares the count date against every entry
    // date); mirroring the flag here keeps the form from demanding an estimate for a gap
    // that will never be closed.
    const latestEntryDate = entries.map(e => e.date_received).filter(Boolean).sort().pop();
    const countCoversEntries = detail.willReconcile
        || (detail.countedAt && latestEntryDate && new Date(latestEntryDate) <= new Date(detail.countedAt));
    const gapQty = (!countCoversEntries || detail.countedQty == null)
        ? null
        : Number((detail.countedQty - projectedQty).toFixed(4));
    const needsEstimate = gapQty != null && gapQty > 0;

    const update = (i, field, value) => {
        setEntries(entries.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
    };

    const submit = async (e) => {
        e.preventDefault();
        const payload = entries
            .filter(en => en.date_received && en.quantity && en.unit_cost)
            .map(en => ({
                date_received: en.date_received,
                quantity: parseFloat(en.quantity),
                unit_cost: parseFloat(en.unit_cost),
                source_reference: en.source_reference || null,
                is_estimate: !en.source_reference,
            }));
        if (payload.length === 0) {
            toast.error('Add at least one receipt with a date, quantity and unit cost.');
            return;
        }
        setSaving(true);
        try {
            await api.post(`/inventory/cost-correction/lines/${detail.line.line_id}/propose`, {
                entries: payload,
                gap_unit_cost: needsEstimate ? parseFloat(gapUnitCost) : null,
                notes: notes || null,
            });
            toast.success('Sent for manager review.');
            onSaved?.();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save.');
        } finally {
            setSaving(false);
        }
    };

    const input = 'w-full px-2 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm';

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 dark:text-slate-400">
                <div>System qty: <strong className="text-gray-900 dark:text-slate-100">{detail.currentQty}</strong></div>
                <div>Counted qty: <strong className="text-gray-900 dark:text-slate-100">{detail.countedQty ?? 'Not counted'}</strong></div>
                <div>After these receipts: <strong className="text-gray-900 dark:text-slate-100">{projectedQty}</strong></div>
            </div>

            {!countCoversEntries && (
                <p className="text-xs text-gray-600 dark:text-slate-400 rounded-lg bg-gray-50 dark:bg-slate-800 p-2">
                    {detail.countedQty == null
                        ? 'This part has not been counted yet. Enter what the supplier documents show — the receipts fix the cost basis now, and a cycle count will settle the quantity later.'
                        : 'The last count is older than these receipts, so it cannot be used to settle the quantity. The receipts still fix the cost basis; the next count will reconcile the stock.'}
                </p>
            )}

            <div className="space-y-2">
                {entries.map((e, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input type="date" max={todayStr} value={e.date_received}
                            onChange={ev => update(i, 'date_received', ev.target.value)}
                            className={`${input} col-span-3`} />
                        <input type="number" step="any" min="0" placeholder="Qty" value={e.quantity}
                            onChange={ev => update(i, 'quantity', ev.target.value)}
                            className={`${input} col-span-2`} />
                        <input type="number" step="any" min="0" placeholder="Unit cost" value={e.unit_cost}
                            onChange={ev => update(i, 'unit_cost', ev.target.value)}
                            className={`${input} col-span-3`} />
                        <input type="text" placeholder="Invoice / DR no." value={e.source_reference}
                            onChange={ev => update(i, 'source_reference', ev.target.value)}
                            className={`${input} col-span-3`} />
                        <button type="button" onClick={() => setEntries(entries.filter((_, idx) => idx !== i))}
                            disabled={entries.length === 1}
                            className="col-span-1 text-gray-400 hover:text-red-600 disabled:opacity-30 text-lg leading-none">
                            ×
                        </button>
                    </div>
                ))}
            </div>

            <button type="button" onClick={() => setEntries([...entries, blankEntry()])}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                + Add another receipt
            </button>

            {needsEstimate && (
                <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                        These receipts leave <strong>{gapQty}</strong> units unaccounted for against the counted
                        quantity. Give an estimated unit cost for the remainder, or add the missing receipts above.
                    </p>
                    <label className="block text-xs text-amber-800 dark:text-amber-200">
                        Estimated unit cost ({currency}) for the {gapQty} undocumented units
                    </label>
                    <input type="number" step="any" min="0" value={gapUnitCost}
                        onChange={ev => setGapUnitCost(ev.target.value)} className={input} />
                </div>
            )}

            {gapQty != null && gapQty < 0 && (
                <p className="text-sm text-gray-600 dark:text-slate-400">
                    These receipts exceed the counted quantity by {Math.abs(gapQty)} units. Approving will record
                    that difference as a stock write-off, which does not affect the cost average.
                </p>
            )}

            <div>
                <label className="block text-sm text-gray-700 dark:text-slate-300 mb-1">Notes for the manager</label>
                <textarea value={notes} onChange={ev => setNotes(ev.target.value)} rows={2} className={input} />
            </div>

            <div className="flex justify-end">
                <button type="submit" disabled={saving}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm">
                    {saving ? 'Saving…' : 'Send for review'}
                </button>
            </div>
        </form>
    );
};

export default CostCorrectionEntryForm;
