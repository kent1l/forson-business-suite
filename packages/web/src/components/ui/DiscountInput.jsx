import { useEffect, useState } from 'react';
import MathExpressionInput from './MathExpressionInput';

/**
 * A discount entered either as a percentage or as a flat amount, never both.
 *
 * Suppliers state discounts both ways — "less 10%" on one invoice, "less ₱500" on the
 * next — and forcing staff to convert one into the other at the keyboard is how
 * rounding errors get typed into the ledger. So the control takes whichever form the
 * paper uses and the database stores that form, with a CHECK constraint enforcing that
 * only one is ever set.
 *
 * Switching modes clears the other field rather than converting between them: a
 * converted figure looks like something the supplier said when it isn't.
 *
 * @param {number|null} percent      current percentage value, or null
 * @param {number|null} amount       current flat amount, or null
 * @param {function} onChange        called with `{ percent, amount }`, exactly one non-null
 * @param {number} [base]            line/document value, used only for the live preview
 * @param {string} [currencySymbol]
 */
const DiscountInput = ({
  percent = null,
  amount = null,
  onChange,
  base = 0,
  currencySymbol = '₱',
  disabled = false,
  compact = false,
  'aria-label': ariaLabel = 'Discount',
}) => {
  // Which unit is selected has to be state of its own, not something derived from
  // whichever field happens to hold a value. Switching units clears both fields — a
  // percentage and an amount are different claims about what the supplier gave, and
  // silently converting one into the other would put a number on screen that nobody
  // agreed to. That leaves an instant where both are empty, and a derived mode would
  // snap straight back to percent, making the peso button impossible to select.
  const [mode, setMode] = useState(() => (amount != null && amount !== '' ? 'amount' : 'percent'));

  // Follow the parent when it hands down a value that settles the question — reopening a
  // saved draft, or loading a receipt whose discount was entered as an amount.
  useEffect(() => {
    if (amount != null && amount !== '') setMode('amount');
    else if (percent != null && percent !== '') setMode('percent');
  }, [percent, amount]);

  const value = mode === 'amount' ? amount : percent;

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    onChange({ percent: null, amount: null });
  };

  const setValue = (next) => {
    const parsed = Number.isFinite(next) ? next : null;
    const empty = parsed == null || parsed === 0;
    onChange(mode === 'amount'
      ? { percent: null, amount: empty ? null : parsed }
      : { percent: empty ? null : parsed, amount: null });
  };

  const resolved = mode === 'amount'
    ? Number(amount) || 0
    : ((Number(base) || 0) * (Number(percent) || 0)) / 100;

  const buttonBase = 'px-2 h-9 text-xs font-semibold border transition-colors disabled:opacity-60';
  const active = 'bg-primary-600 text-white border-primary-600';
  const inactive = 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch">
        <button
          type="button"
          disabled={disabled}
          onClick={() => switchMode('percent')}
          className={`${buttonBase} rounded-l-md ${mode === 'percent' ? active : inactive}`}
          aria-pressed={mode === 'percent'}
          title="Discount as a percentage"
        >
          %
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => switchMode('amount')}
          className={`${buttonBase} -ml-px ${mode === 'amount' ? active : inactive}`}
          aria-pressed={mode === 'amount'}
          title="Discount as a flat amount"
        >
          {currencySymbol}
        </button>
        <MathExpressionInput
          value={value ?? ''}
          onChange={setValue}
          disabled={disabled}
          aria-label={`${ariaLabel} (${mode === 'amount' ? currencySymbol : '%'})`}
          className="w-full h-9 px-2 -ml-px border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-r-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
        />
      </div>
      {/* Percentages are hard to sanity-check against paper; show what they come to. */}
      {!compact && mode === 'percent' && resolved > 0 && (
        <span className="text-[11px] text-gray-500 dark:text-slate-400 text-right tabular-nums">
          = {currencySymbol}{resolved.toFixed(2)}
        </span>
      )}
    </div>
  );
};

export default DiscountInput;
