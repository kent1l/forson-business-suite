import { useState } from 'react';
import Modal from '../ui/Modal';
import MathExpressionInput from '../ui/MathExpressionInput';
import { formatCurrency } from '../../utils/currency';
import { REJECTION_REASONS } from '../../utils/grnCosting';

/**
 * Send goods back — whether that is noticing damage while unloading, or discovering it
 * a week later.
 *
 * The system draws no distinction between the two, because there isn't a real one: in
 * both cases these units came in on this document and are going out again. What differs
 * is only what has to be unwound, and that follows from whether the receipt has posted.
 * The modal says which of the two is about to happen, so nobody is surprised by a
 * ledger entry they did not expect.
 */
const ReturnLineModal = ({ isOpen, onClose, onConfirm, line, isPosted, currencySymbol = '₱' }) => {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!line) return null;

  const alreadyReturned = Number(line.return_quantity) || 0;
  const remaining = (Number(line.quantity) || 0) - alreadyReturned;
  const unitCost = Number(line.landed_unit_cost ?? line.cost_price) || 0;

  const quantityValid = Number(quantity) > 0 && Number(quantity) <= remaining + 0.0001;
  const reasonValid = !!reason && (reason !== 'Other' || notes.trim().length > 0);
  const canConfirm = quantityValid && reasonValid && !saving;

  const submit = async () => {
    setSaving(true);
    try {
      await onConfirm({ return_quantity: Number(quantity), rejection_reason: reason, notes: notes.trim() || null });
      setQuantity(1); setReason(''); setNotes('');
      onClose();
    } catch {
      // The caller has already surfaced the reason. Stay open with the figures intact so
      // it can be corrected and retried, rather than making the user start again.
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full h-9 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isPosted ? 'Return to supplier' : 'Reject at the dock'} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-md bg-gray-50 dark:bg-slate-900/60 p-3">
          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
            {line.display_name || line.internal_sku || `Part ${line.part_id}`}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            {line.quantity} received at {formatCurrency(unitCost, currencySymbol)} each
            {alreadyReturned > 0 && ` · ${alreadyReturned} already sent back`}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            How many are going back?
          </label>
          <MathExpressionInput value={quantity} onChange={(v) => setQuantity(v || 0)} className={`${inputClass} text-right`} />
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{remaining} still available to return.</p>
          {!quantityValid && Number(quantity) > 0 && (
            <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">That is more than this line still holds.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Why?</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
            <option value="">Choose a reason…</option>
            {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {reason === 'Other' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">What was wrong?</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={90}
              placeholder="So it can be raised with the supplier later"
              className={inputClass}
            />
          </div>
        )}

        {/* Say plainly what is about to happen. A posted receipt moves money. */}
        <div className={`rounded-md p-3 text-xs ${isPosted
          ? 'bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
          : 'bg-blue-50 text-blue-900 dark:bg-blue-900/20 dark:text-blue-200'}`}
        >
          {isPosted ? (
            <>
              This receipt has already posted, so returning {Number(quantity) || 0} will take the stock back out,
              recalculate the average cost, and credit about{' '}
              <strong>{formatCurrency((Number(quantity) || 0) * (Number(line.cost_price) || 0), currencySymbol)}</strong>{' '}
              against the supplier&apos;s bill. Freight is not refunded — the carrier still delivered them.
            </>
          ) : (
            <>
              Nothing has been posted yet, so this only reduces what the receipt records. The freight and any
              overall discount will be re-spread across the lines that remain.
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={submit}
          className="px-4 py-2 text-sm rounded-lg bg-danger-600 text-white hover:bg-danger-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Recording…' : isPosted ? 'Return to supplier' : 'Reject'}
        </button>
      </div>
    </Modal>
  );
};

export default ReturnLineModal;
