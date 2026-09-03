import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import SupplierForm from '../forms/SupplierForm';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from '../ui/MathExpressionInput';
import { formatCurrency } from '../../utils/currency';
import { computeCosting, METHOD_A, METHOD_B } from '../../utils/grnCosting';

/**
 * Spread a shipment's delivery charge across its lines.
 *
 * The default — pro-rata by invoice value — is right for a box of mixed small parts,
 * and wrong for the heavy items an auto-parts store receives constantly. A brake drum
 * and a set of gaskets can cost the same on paper while costing wildly different
 * amounts to haul, so the wizard's middle step exists to let the receiver charge those
 * items a flat amount off the top before anything is pro-rated.
 *
 * Three steps, because that is the order the receiver actually has the information in:
 * the freight bill first, then the pallet in front of them, then a check that the
 * numbers reconcile before they commit.
 */
const STEPS = [
  { key: 'charge', label: 'Freight charge' },
  { key: 'heavy', label: 'Heavy items' },
  { key: 'review', label: 'Review' },
];

const FreightAllocationWizard = ({
  isOpen,
  onClose,
  onApply,
  onCreateCarrier,
  lines,
  suppliers = [],
  initialFreightAmount = 0,
  initialFreightSupplierId = '',
  initialMethod = METHOD_A,
  overallDiscountPercent = null,
  overallDiscountAmount = null,
}) => {
  const [step, setStep] = useState(0);
  const [isCarrierModalOpen, setIsCarrierModalOpen] = useState(false);
  const [freightAmount, setFreightAmount] = useState(initialFreightAmount || 0);
  const [freightSupplierId, setFreightSupplierId] = useState(initialFreightSupplierId || '');
  const [method, setMethod] = useState(initialMethod || METHOD_A);
  const [overrides, setOverrides] = useState(() => {
    const seed = {};
    lines.forEach((l) => {
      if (l.override_freight_amount != null && l.override_freight_amount !== '') {
        seed[l.part_id] = Number(l.override_freight_amount);
      }
    });
    return seed;
  });

  // Freight often arrives from a hauler nobody has set up yet, and leaving the wizard to
  // go and create one would strand a half-filled receipt. Typing a name into the picker
  // registers the carrier with just that name — enough to raise their bill — while the
  // New button opens the full supplier form for when the terms and contact are to hand.
  const saveCarrier = async (payload) => {
    const created = await onCreateCarrier(payload);
    if (created) {
      setFreightSupplierId(String(created.supplier_id));
      setIsCarrierModalOpen(false);
    }
  };

  const workingLines = useMemo(() => lines.map((l) => ({
    ...l,
    override_freight_amount: overrides[l.part_id] ?? null,
  })), [lines, overrides]);

  const costing = useMemo(() => computeCosting({
    lines: workingLines,
    freightAmount,
    freightMethod: method,
    overallDiscountPercent,
    overallDiscountAmount,
    recomputeSalePrice: false,
  }), [workingLines, freightAmount, method, overallDiscountPercent, overallDiscountAmount]);

  const reservedTotal = costing.totals.freight_reserved_by_overrides;
  const overAllocated = costing.errors.some((e) => e.code === 'FREIGHT_OVERRIDE_EXCEEDS_TOTAL');
  const canAdvance = step === 0
    ? Number(freightAmount) >= 0 && (Number(freightAmount) === 0 || !!freightSupplierId)
    : !overAllocated;

  const setOverride = (partId, value) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value == null || value === '' || Number(value) <= 0) delete next[partId];
      else next[partId] = Number(value);
      return next;
    });
  };

  const apply = () => {
    onApply({
      freight_amount: Number(freightAmount) || 0,
      freight_supplier_id: freightSupplierId || null,
      freight_allocation_method: method,
      overrides,
    });
    onClose();
  };

  const inputClass = 'w-full h-9 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Allocate freight" maxWidth="max-w-4xl">
      <ol className="flex items-center gap-2 mb-5 text-xs font-medium">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`flex items-center justify-center w-6 h-6 rounded-full ${
              i === step ? 'bg-primary-600 text-white'
                : i < step ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                  : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500'}`}
            >
              {i + 1}
            </span>
            <span className={i === step ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="text-gray-300 dark:text-slate-600">→</span>}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Total freight on this shipment
            </label>
            <MathExpressionInput value={freightAmount} onChange={(v) => setFreightAmount(v || 0)} className={inputClass} />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              This is added to the cost of the goods, not recorded as an expense — it is what the stock
              actually cost to get here, so it belongs in the unit cost and in the price built from it.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Carrier to bill
              <InfoTip text="Freight is billed separately from the goods, so it posts its own payable against the carrier. The parts supplier's bill only covers what they charged for the parts." />
            </label>
            <div className="flex items-center space-x-2">
              <div className="flex-grow">
                <Combobox
                  options={suppliers.map((s) => ({ value: String(s.supplier_id), label: s.supplier_name }))}
                  value={freightSupplierId ? String(freightSupplierId) : ''}
                  onChange={setFreightSupplierId}
                  placeholder="Who is charging for the delivery?"
                  allowCreate={!!onCreateCarrier}
                  onCreate={(name) => saveCarrier({ supplier_name: name, is_active: true })}
                />
              </div>
              {onCreateCarrier && (
                <button
                  type="button"
                  onClick={() => setIsCarrierModalOpen(true)}
                  className="flex-shrink-0 px-3 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 text-sm"
                >
                  New
                </button>
              )}
            </div>
            {Number(freightAmount) > 0 && !freightSupplierId && (
              <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                Name the carrier so the delivery charge can be billed.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">How to split it</legend>
            <label className="flex items-start gap-2 p-2 rounded-md border border-gray-200 dark:border-slate-700 cursor-pointer">
              <input type="radio" checked={method === METHOD_A} onChange={() => setMethod(METHOD_A)} className="mt-1" />
              <span>
                <span className="block text-sm text-gray-900 dark:text-slate-100">By invoice value</span>
                <span className="block text-xs text-gray-500 dark:text-slate-400">
                  Each line takes a share of the freight in proportion to what it is worth. Heavy items can be
                  charged a flat amount instead on the next step.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 p-2 mt-2 rounded-md border border-gray-200 dark:border-slate-700 opacity-60 cursor-not-allowed">
              <input type="radio" disabled checked={method === METHOD_B} onChange={() => setMethod(METHOD_B)} className="mt-1" />
              <span>
                <span className="block text-sm text-gray-900 dark:text-slate-100">
                  By weight or volume
                  <InfoTip text="Not available yet: the parts catalogue does not record weights or dimensions, so there is nothing to allocate on. Use a flat amount on the heavy lines instead." />
                </span>
                <span className="block text-xs text-gray-500 dark:text-slate-400">Needs part weights, which the catalogue does not hold yet.</span>
              </span>
            </label>
          </fieldset>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Charge the bulky items what they really cost to haul. Whatever is left over is split across the
            remaining lines by value.
          </p>
          <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900/60 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Item</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Qty</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Line value</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300 w-40">Flat freight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {workingLines.map((line, i) => (
                  <tr key={line.part_id} className={overrides[line.part_id] != null ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}>
                    <td className="px-3 py-2 text-gray-900 dark:text-slate-100">{line.display_name || line.internal_sku || `Part ${line.part_id}`}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{line.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">
                      {formatCurrency(costing.lines[i]?.net_line_value ?? 0)}
                    </td>
                    <td className="px-3 py-2">
                      <MathExpressionInput
                        value={overrides[line.part_id] ?? ''}
                        onChange={(v) => setOverride(line.part_id, v)}
                        className={inputClass}
                        aria-label={`Flat freight for ${line.display_name || line.part_id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-slate-400">Reserved for heavy items</span>
            <span className={`font-mono ${overAllocated ? 'text-danger-600 dark:text-danger-400' : 'text-gray-900 dark:text-slate-100'}`}>
              {formatCurrency(reservedTotal)} of {formatCurrency(Number(freightAmount) || 0)}
            </span>
          </div>
          {overAllocated && (
            <p className="text-xs text-danger-600 dark:text-danger-400">
              The flat amounts add up to more than the freight on this shipment. Reduce them, or raise the freight total.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="max-h-80 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900/60 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Item</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Unit cost</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Freight</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 dark:text-slate-300">Landed unit cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {workingLines.map((line, i) => {
                  const c = costing.lines[i];
                  return (
                    <tr key={line.part_id}>
                      <td className="px-3 py-2 text-gray-900 dark:text-slate-100">
                        {line.display_name || line.internal_sku || `Part ${line.part_id}`}
                        {overrides[line.part_id] != null && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">flat</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{formatCurrency(c?.cost_price ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-slate-400">{formatCurrency(c?.allocated_freight_amount ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(c?.landed_unit_cost ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* The reconciliation the receiver actually needs: every peso of the carrier's
              charge has to land on a line, or inventory is valued at something the
              freight bill does not support. */}
          <div className="rounded-md bg-gray-50 dark:bg-slate-900/60 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-slate-400">Charged by the carrier</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(Number(freightAmount) || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-slate-400">Flat amounts on heavy items</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(reservedTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-slate-400">Split by value across the rest</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(costing.totals.freight_pro_rated)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 dark:border-slate-700 pt-1 font-semibold">
              <span className="text-gray-900 dark:text-slate-100">Allocated to stock</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(costing.totals.freight_allocated)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={step === 0 ? onClose : () => setStep(step - 1)}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <button
          type="button"
          disabled={!canAdvance}
          onClick={step === STEPS.length - 1 ? apply : () => setStep(step + 1)}
          className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {step === STEPS.length - 1 ? 'Apply to receipt' : 'Next'}
        </button>
      </div>

      <Modal
        isOpen={isCarrierModalOpen}
        onClose={() => setIsCarrierModalOpen(false)}
        title="Add New Carrier"
        maxWidth="max-w-lg"
        zIndexClass="z-50"
      >
        <SupplierForm onSave={saveCarrier} onCancel={() => setIsCarrierModalOpen(false)} />
      </Modal>
    </Modal>
  );
};

export default FreightAllocationWizard;
