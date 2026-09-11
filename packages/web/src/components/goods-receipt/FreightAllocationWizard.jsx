import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Combobox from '../ui/Combobox';
import SupplierForm from '../forms/SupplierForm';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from '../ui/MathExpressionInput';
import api from '../../api';
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

const makeDefaultRow = (extra = {}) => ({
  id: `fc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
  supplier_id: '',
  amount: '',
  receipt_number: '',
  notes: '',
  is_paid: false,
  payment_method_id: '',
  ...extra,
});

const FreightAllocationWizard = ({
  isOpen,
  onClose,
  onApply,
  onCreateCarrier,
  lines,
  suppliers = [],
  initialFreightAmount = 0,
  initialFreightSupplierId = '',
  initialFreightCosts = [],
  initialMethod = METHOD_A,
  overallDiscountPercent = null,
  overallDiscountAmount = null,
}) => {
  const [step, setStep] = useState(0);
  const [isCarrierModalOpen, setIsCarrierModalOpen] = useState(false);
  const [carrierTargetIndex, setCarrierTargetIndex] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
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

  const [freightCosts, setFreightCosts] = useState(() => {
    if (initialFreightCosts && initialFreightCosts.length > 0) {
      return initialFreightCosts.map((c, idx) => ({
        id: `fc_${idx}_${Date.now()}`,
        supplier_id: c.supplier_id ? String(c.supplier_id) : '',
        amount: c.amount != null ? c.amount : '',
        receipt_number: c.receipt_number || '',
        notes: c.notes || '',
        is_paid: Boolean(c.is_paid),
        payment_method_id: c.payment_method_id ? String(c.payment_method_id) : '',
      }));
    }
    if (Number(initialFreightAmount) > 0 || initialFreightSupplierId) {
      return [{
        id: `fc_0_${Date.now()}`,
        supplier_id: initialFreightSupplierId ? String(initialFreightSupplierId) : '',
        amount: initialFreightAmount || '',
        receipt_number: '',
        notes: '',
        is_paid: false,
        payment_method_id: '',
      }];
    }
    return [makeDefaultRow()];
  });

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    api.get('/payment-methods/enabled')
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        const filtered = list.filter((m) => m.ap_enabled !== false && m.type !== 'cheque');
        setPaymentMethods(filtered);
      })
      .catch(() => {
        setPaymentMethods([
          { method_id: 1, code: 'cash', name: 'Cash' },
          { method_id: 4, code: 'bank_transfer', name: 'Bank Transfer' },
          { method_id: 6, code: 'gcash', name: 'GCash' },
        ]);
      });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialFreightCosts && initialFreightCosts.length > 0) {
      setFreightCosts(initialFreightCosts.map((c, idx) => ({
        id: `fc_${idx}_${Date.now()}`,
        supplier_id: c.supplier_id ? String(c.supplier_id) : '',
        amount: c.amount != null ? c.amount : '',
        receipt_number: c.receipt_number || '',
        notes: c.notes || '',
        is_paid: Boolean(c.is_paid),
        payment_method_id: c.payment_method_id ? String(c.payment_method_id) : '',
      })));
    } else if (Number(initialFreightAmount) > 0 || initialFreightSupplierId) {
      setFreightCosts([{
        id: `fc_0_${Date.now()}`,
        supplier_id: initialFreightSupplierId ? String(initialFreightSupplierId) : '',
        amount: initialFreightAmount || '',
        receipt_number: '',
        notes: '',
        is_paid: false,
        payment_method_id: '',
      }]);
    } else {
      setFreightCosts([makeDefaultRow()]);
    }
  }, [isOpen, initialFreightCosts, initialFreightAmount, initialFreightSupplierId]);

  const defaultPaymentMethodId = useMemo(() => {
    return paymentMethods.find((m) => m.code === 'cash')?.method_id || paymentMethods[0]?.method_id || 1;
  }, [paymentMethods]);

  const totalFreightAmount = useMemo(() => {
    return freightCosts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  }, [freightCosts]);

  // Freight often arrives from a hauler nobody has set up yet, and leaving the wizard to
  // go and create one would strand a half-filled receipt. Typing a name into the picker
  // registers the carrier with just that name — enough to raise their bill — while the
  // New button opens the full supplier form for when the terms and contact are to hand.
  const saveCarrier = async (payload, targetIdx = carrierTargetIndex) => {
    const created = await onCreateCarrier(payload);
    if (created && targetIdx != null) {
      setFreightCosts((prev) => {
        const next = [...prev];
        next[targetIdx] = { ...next[targetIdx], supplier_id: String(created.supplier_id) };
        return next;
      });
      setIsCarrierModalOpen(false);
      setCarrierTargetIndex(null);
    }
  };

  const addFreightRow = () => {
    setFreightCosts((prev) => [
      ...prev,
      makeDefaultRow({ payment_method_id: defaultPaymentMethodId ? String(defaultPaymentMethodId) : '' }),
    ]);
  };

  const removeFreightRow = (index) => {
    setFreightCosts((prev) => {
      if (prev.length <= 1) {
        return [makeDefaultRow({ payment_method_id: defaultPaymentMethodId ? String(defaultPaymentMethodId) : '' })];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const updateFreightRow = (index, field, value) => {
    setFreightCosts((prev) => {
      const next = [...prev];
      const updated = { ...next[index], [field]: value };
      if (field === 'is_paid' && value === true && !updated.payment_method_id && defaultPaymentMethodId) {
        updated.payment_method_id = String(defaultPaymentMethodId);
      }
      next[index] = updated;
      return next;
    });
  };

  const workingLines = useMemo(() => lines.map((l) => ({
    ...l,
    override_freight_amount: overrides[l.part_id] ?? null,
  })), [lines, overrides]);

  const costing = useMemo(() => computeCosting({
    lines: workingLines,
    freightAmount: totalFreightAmount,
    freightMethod: method,
    overallDiscountPercent,
    overallDiscountAmount,
    recomputeSalePrice: false,
  }), [workingLines, totalFreightAmount, method, overallDiscountPercent, overallDiscountAmount]);

  const reservedTotal = costing.totals.freight_reserved_by_overrides;
  const overAllocated = costing.errors.some((e) => e.code === 'FREIGHT_OVERRIDE_EXCEEDS_TOTAL');
  const canAdvance = useMemo(() => {
    if (step === 0) {
      if (totalFreightAmount < 0) return false;
      for (const c of freightCosts) {
        const amt = Number(c.amount) || 0;
        if (amt > 0) {
          if (!c.is_paid && !c.supplier_id) return false;
        }
      }
      return true;
    }
    return !overAllocated;
  }, [step, totalFreightAmount, freightCosts, overAllocated]);

  const setOverride = (partId, value) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value == null || value === '' || Number(value) <= 0) delete next[partId];
      else next[partId] = Number(value);
      return next;
    });
  };

  const apply = () => {
    const validFreightCosts = freightCosts
      .filter((c) => Number(c.amount) > 0)
      .map((c) => ({
        supplier_id: c.supplier_id ? Number(c.supplier_id) : null,
        amount: Number(c.amount) || 0,
        receipt_number: c.receipt_number?.trim() || null,
        notes: c.notes?.trim() || null,
        is_paid: Boolean(c.is_paid),
        payment_method_id: c.is_paid && c.payment_method_id ? Number(c.payment_method_id) : (c.is_paid ? Number(defaultPaymentMethodId) : null),
      }));

    onApply({
      freight_amount: Number(totalFreightAmount) || 0,
      freight_supplier_id: validFreightCosts[0]?.supplier_id || null,
      freight_costs: validFreightCosts,
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
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Freight-In Charges</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Record all delivery charges (multiple couriers, air freight, or travel/fuel/tolls for pickup).
              </p>
            </div>
            <button
              type="button"
              onClick={addFreightRow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-900/40 dark:text-primary-300 border border-primary-200 dark:border-primary-800 transition-colors"
            >
              <span className="text-sm font-bold leading-none">+</span> Add freight charge
            </button>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {freightCosts.map((charge, idx) => {
              const isUnpaidMissingCarrier = Number(charge.amount) > 0 && !charge.is_paid && !charge.supplier_id;
              return (
                <div
                  key={charge.id}
                  className={`p-3.5 rounded-xl border transition-colors ${
                    isUnpaidMissingCarrier
                      ? 'border-danger-300 bg-danger-50/20 dark:border-danger-800 dark:bg-danger-900/10'
                      : 'border-gray-200 bg-gray-50/50 dark:border-slate-700 dark:bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-gray-200/80 dark:border-slate-700/80">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                      Charge #{idx + 1}
                    </span>
                    {freightCosts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeFreightRow(idx)}
                        className="text-xs text-danger-600 dark:text-danger-400 hover:underline"
                        aria-label={`Remove charge ${idx + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-6">
                      <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Carrier / Courier
                        <span className="text-gray-400 dark:text-slate-500 font-normal ml-1">
                          {charge.is_paid ? '(optional for direct pickup)' : '(required to bill)'}
                        </span>
                      </label>
                      <div className="flex items-center space-x-1.5">
                        <div className="flex-grow">
                          <Combobox
                            options={suppliers.map((s) => ({ value: String(s.supplier_id), label: s.supplier_name }))}
                            value={charge.supplier_id ? String(charge.supplier_id) : ''}
                            onChange={(val) => updateFreightRow(idx, 'supplier_id', val)}
                            placeholder="Who delivered / hauled?"
                            allowCreate={!!onCreateCarrier}
                            onCreate={(name) => saveCarrier({ supplier_name: name, is_active: true }, idx)}
                          />
                        </div>
                        {onCreateCarrier && (
                          <button
                            type="button"
                            onClick={() => { setCarrierTargetIndex(idx); setIsCarrierModalOpen(true); }}
                            className="flex-shrink-0 px-2.5 py-1.5 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 text-xs"
                          >
                            New
                          </button>
                        )}
                      </div>
                      {isUnpaidMissingCarrier && (
                        <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                          Select a carrier so an Accounts Payable bill can be raised.
                        </p>
                      )}
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Amount (₱)
                      </label>
                      <MathExpressionInput
                        value={charge.amount}
                        onChange={(v) => updateFreightRow(idx, 'amount', v != null ? v : '')}
                        className={inputClass}
                        placeholder="0.00"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Receipt / Waybill #
                      </label>
                      <input
                        type="text"
                        value={charge.receipt_number}
                        onChange={(e) => updateFreightRow(idx, 'receipt_number', e.target.value)}
                        placeholder="e.g. LBC-981240"
                        className="w-full h-9 px-2.5 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                      />
                    </div>

                    <div className="md:col-span-6 flex flex-col justify-center">
                      <label className="flex items-center gap-2 cursor-pointer mt-1">
                        <input
                          type="checkbox"
                          checked={charge.is_paid}
                          onChange={(e) => updateFreightRow(idx, 'is_paid', e.target.checked)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                        />
                        <span className="text-xs font-medium text-gray-900 dark:text-slate-100">
                          Already paid (settle payment in A/P now)
                        </span>
                      </label>
                      <span className="text-[11px] text-gray-500 dark:text-slate-400 ml-6">
                        {charge.is_paid
                          ? 'Posts bill & instant settlement; will not sit in open payables.'
                          : 'Leaves bill open in A/P to be paid later.'}
                      </span>
                    </div>

                    {charge.is_paid ? (
                      <div className="md:col-span-3">
                        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                          Payment Method
                        </label>
                        <select
                          value={charge.payment_method_id || defaultPaymentMethodId || ''}
                          onChange={(e) => updateFreightRow(idx, 'payment_method_id', e.target.value)}
                          className="w-full h-9 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {paymentMethods.map((pm) => (
                            <option key={pm.method_id} value={String(pm.method_id)}>
                              {pm.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="hidden md:block md:col-span-3" />
                    )}

                    <div className={charge.is_paid ? 'md:col-span-3' : 'md:col-span-6'}>
                      <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                        Notes / Route / Courier
                      </label>
                      <input
                        type="text"
                        value={charge.notes}
                        onChange={(e) => updateFreightRow(idx, 'notes', e.target.value)}
                        placeholder="e.g. Warehouse gas & toll"
                        className="w-full h-9 px-2.5 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-slate-800/80 text-xs">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-gray-500 dark:text-slate-400">Total freight: </span>
                <span className="font-mono font-bold text-sm text-gray-900 dark:text-slate-100">
                  {formatCurrency(totalFreightAmount)}
                </span>
              </div>
              {freightCosts.some((c) => Number(c.amount) > 0) && (
                <div className="text-gray-500 dark:text-slate-400">
                  (Paid: <span className="font-mono text-success-600 dark:text-success-400">{formatCurrency(freightCosts.filter(c => c.is_paid).reduce((s, c) => s + (Number(c.amount) || 0), 0))}</span>
                  {' · '}
                  Unpaid A/P: <span className="font-mono text-amber-600 dark:text-amber-400">{formatCurrency(freightCosts.filter(c => !c.is_paid).reduce((s, c) => s + (Number(c.amount) || 0), 0))}</span>)
                </div>
              )}
            </div>
            <span className="text-gray-500 dark:text-slate-400">
              Capitalised into inventory landed cost
            </span>
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
              {formatCurrency(reservedTotal)} of {formatCurrency(Number(totalFreightAmount) || 0)}
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
            {freightCosts.filter((c) => Number(c.amount) > 0).length > 0 && (
              <div className="pb-2 mb-2 border-b border-gray-200 dark:border-slate-700 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Freight Breakdown
                </div>
                {freightCosts.filter((c) => Number(c.amount) > 0).map((c, i) => {
                  const supplier = suppliers.find((s) => String(s.supplier_id) === String(c.supplier_id));
                  return (
                    <div key={c.id || i} className="flex justify-between text-xs">
                      <span className="text-gray-600 dark:text-slate-400">
                        {supplier?.supplier_name || 'Direct pickup / travel'}
                        {c.receipt_number ? ` (Rcpt #${c.receipt_number})` : ''}
                        {c.is_paid ? ' · Paid' : ' · Unpaid (A/P)'}
                      </span>
                      <span className="font-mono text-gray-900 dark:text-slate-100">
                        {formatCurrency(Number(c.amount) || 0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-slate-400">Total freight charges</span>
              <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(Number(totalFreightAmount) || 0)}</span>
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
        onClose={() => { setIsCarrierModalOpen(false); setCarrierTargetIndex(null); }}
        title="Add New Carrier"
        maxWidth="max-w-lg"
        zIndexClass="z-50"
      >
        <SupplierForm onSave={(payload) => saveCarrier(payload, carrierTargetIndex)} onCancel={() => { setIsCarrierModalOpen(false); setCarrierTargetIndex(null); }} />
      </Modal>
    </Modal>
  );
};

export default FreightAllocationWizard;
