import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import StatusBadge from '../ui/StatusBadge';
import InfoTip from '../ui/InfoTip';
import { formatCurrency } from '../../utils/currency';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const fmtQty = (q) => {
    const n = Number(q) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
};
const num = (v) => Number(v) || 0;

const LINK_LABEL = {
    goods: 'Goods',
    freight: 'Freight',
};

/** One "label … amount" row of the totals ladder. */
const TotalRow = ({ label, value, tone = 'muted', sign = '', tip, strong = false }) => {
    const toneClass = {
        muted: 'text-gray-600 dark:text-slate-400',
        strong: 'text-gray-700 dark:text-slate-300',
        warn: 'text-amber-700 dark:text-amber-400',
    }[tone];
    return (
        <div className={`flex justify-between ${strong ? 'font-medium' : ''}`}>
            <span className={`inline-flex items-center gap-1 ${toneClass}`}>
                {label}
                {tip && <InfoTip label={label}>{tip}</InfoTip>}
            </span>
            <span className={`font-mono ${tone === 'warn' ? toneClass : 'text-gray-900 dark:text-slate-100'}`}>
                {sign}{formatCurrency(value)}
            </span>
        </div>
    );
};

/**
 * The goods receipt(s) a payable is charging for, read-only.
 *
 * A bill and a receipt are two views of the same delivery — one says what we owe,
 * the other says what actually arrived — and the question an AP clerk asks before
 * paying is whether they agree. Answering it takes the whole receipt, not a summary:
 * the same lines, the same discounts, the same freight split and the same totals
 * ladder the Goods Receipt screen shows, so a disagreement can be traced to the line
 * that causes it without a detour through the Goods Receipt module, which needs its
 * own permissions and is built for editing receipts rather than checking one.
 *
 * `freight` receipts are the other case: the bill is the carrier's, so its lines
 * are the goods that were carried, not what is being charged. The receipt's
 * freight amount is what that bill should match, so it is called out separately.
 */
const BillGoodsReceiptsModal = ({ isOpen, onClose, bill }) => {
    const [receipts, setReceipts] = useState([]);
    const [loading, setLoading] = useState(false);

    const billId = bill?.bill_id;

    const fetchReceipts = useCallback(async () => {
        if (!billId) return;
        setLoading(true);
        try {
            const { data } = await api.get(`/ap/supplier-bills/${billId}/goods-receipts`);
            setReceipts(data?.data || []);
        } catch {
            toast.error('Failed to load the goods receipts for this bill');
            setReceipts([]);
        } finally {
            setLoading(false);
        }
    }, [billId]);

    useEffect(() => {
        if (!isOpen) { setReceipts([]); return; }
        fetchReceipts();
    }, [isOpen, fetchReceipts]);

    if (!bill) return null;

    const billLabel = bill.bill_number || `Bill #${bill.bill_id}`;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Goods Receipts — ${billLabel}`}
            maxWidth="max-w-7xl"
        >
            <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-slate-400">
                    <span>Bill total: <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(bill.total_amount)}</span></span>
                    <span>Bill date: {fmtDate(bill.bill_date)}</span>
                    {bill.status && <StatusBadge tone="neutral" label={bill.status} />}
                </div>

                {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading goods receipts…</p>}

                {!loading && receipts.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                        No goods receipt is linked to this payable. That is expected for a bill recorded
                        on its own — attach items to it from the Bills tab and a receipt will be created.
                    </p>
                )}

                {!loading && receipts.map((grn) => {
                    const isFreight = grn.link_type === 'freight';
                    const totals = grn.totals || {};
                    const expected = isFreight ? num(grn.freight_amount) : num(grn.goods_value);
                    const variance = num(bill.total_amount) - expected;
                    const hasReturns = num(totals.returned_value) > 0;
                    return (
                        <div key={grn.grn_id} className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-900/50 border-b border-gray-200 dark:border-slate-700">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-slate-100">
                                        {grn.grn_number}
                                    </span>
                                    <StatusBadge
                                        tone={isFreight ? 'info' : 'primary'}
                                        label={LINK_LABEL[grn.link_type] || grn.link_type}
                                    />
                                    {grn.status === 'Voided' && <StatusBadge tone="danger" label="Voided" />}
                                    {grn.workflow_status && grn.workflow_status !== 'Posted' && (
                                        <StatusBadge tone="warning" label={grn.workflow_status} />
                                    )}
                                    {grn.is_backfill && <StatusBadge tone="neutral" label="Backfill" />}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                                    <span>Received {fmtDate(grn.receipt_date)}</span>
                                    <span>From {grn.supplier_name}</span>
                                    {grn.received_by_name && <span>By {grn.received_by_name}</span>}
                                    {grn.po_number && <span>PO {grn.po_number}</span>}
                                    {grn.supplier_invoice_no && <span>Supplier invoice {grn.supplier_invoice_no}</span>}
                                    {num(grn.freight_amount) > 0 && (
                                        <span>
                                            Freight {formatCurrency(grn.freight_amount)}
                                            {grn.freight_supplier_name ? ` — ${grn.freight_supplier_name}` : ''}
                                        </span>
                                    )}
                                    {num(grn.overall_discount_percent) > 0 && (
                                        <span>Overall discount {num(grn.overall_discount_percent)}%</span>
                                    )}
                                    {num(grn.overall_discount_amount) > 0 && (
                                        <span>Overall discount {formatCurrency(grn.overall_discount_amount)}</span>
                                    )}
                                </div>
                                {grn.status === 'Voided' && (
                                    <div className="mt-1 text-xs text-danger-600 dark:text-danger-400">
                                        Voided {grn.voided_at ? new Date(grn.voided_at).toLocaleString() : ''}
                                        {grn.voided_by_name ? ` by ${grn.voided_by_name}` : ''}
                                        {grn.void_reason ? ` — ${grn.void_reason}` : ''}
                                    </div>
                                )}
                            </div>

                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="text-left text-xs uppercase text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800">
                                        <tr>
                                            <th className="px-4 py-2 font-semibold">Item</th>
                                            <th className="px-3 py-2 font-semibold text-right">Received</th>
                                            <th className="px-3 py-2 font-semibold text-right">Returned</th>
                                            <th className="px-3 py-2 font-semibold text-right">Accepted</th>
                                            <th className="px-3 py-2 font-semibold text-right">Unit Cost</th>
                                            <th className="px-3 py-2 font-semibold text-right">Gross</th>
                                            <th className="px-3 py-2 font-semibold text-right">
                                                <span className="inline-flex items-center gap-1">
                                                    Discount
                                                    <InfoTip label="Line discount">
                                                        A reduction on this line only, as the supplier stated it. Shown as the
                                                        peso value it worked out to, whether it was entered as a percentage or
                                                        an amount.
                                                    </InfoTip>
                                                </span>
                                            </th>
                                            <th className="px-3 py-2 font-semibold text-right">Net</th>
                                            <th className="px-3 py-2 font-semibold text-right">
                                                <span className="inline-flex items-center gap-1">
                                                    Freight
                                                    <InfoTip label="Allocated freight">
                                                        This line&apos;s share of the delivery charge, pro-rated by net value
                                                        unless the line was given a flat amount of its own.
                                                    </InfoTip>
                                                </span>
                                            </th>
                                            <th className="px-3 py-2 font-semibold text-right">
                                                <span className="inline-flex items-center gap-1">
                                                    Landed
                                                    <InfoTip label="Landed unit cost">
                                                        What one unit really cost: the supplier&apos;s price, less discounts,
                                                        plus its share of the freight. This is the figure that posted to
                                                        inventory.
                                                    </InfoTip>
                                                </span>
                                            </th>
                                            <th className="px-3 py-2 font-semibold text-right">Line Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                        {grn.lines.length === 0 && (
                                            <tr><td colSpan={11} className="px-4 py-4 text-center text-gray-500 dark:text-slate-400">This receipt has no lines.</td></tr>
                                        )}
                                        {grn.lines.map((line) => (
                                            <tr key={line.grn_line_id}>
                                                <td className="px-4 py-2 text-gray-900 dark:text-slate-100">
                                                    {line.display_name}
                                                    {line.internal_sku && (
                                                        <span className="block text-xs font-mono text-gray-400 dark:text-slate-500">{line.internal_sku}</span>
                                                    )}
                                                    {line.rejection_reason && (
                                                        <span className="block text-xs text-danger-600 dark:text-danger-400">
                                                            Rejected: {line.rejection_reason}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtQty(line.quantity)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-amber-700 dark:text-amber-400">
                                                    {num(line.return_quantity) > 0 ? fmtQty(line.return_quantity) : '—'}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtQty(line.accepted_quantity)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{formatCurrency(line.cost_price)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-500 dark:text-slate-400">{formatCurrency(line.gross_accepted)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-500 dark:text-slate-400">
                                                    {num(line.line_discount_value) > 0 ? `−${formatCurrency(line.line_discount_value)}` : '—'}
                                                    {num(line.line_discount_percent) > 0 && (
                                                        <span className="block text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                                                            {num(line.line_discount_percent)}%
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{formatCurrency(line.net_line_value)}</td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-500 dark:text-slate-400">
                                                    {formatCurrency(line.allocated_freight_amount)}
                                                    {line.override_freight_amount != null && (
                                                        <span className="block text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">flat</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900 dark:text-slate-100">
                                                    {line.landed_unit_cost != null ? formatCurrency(line.landed_unit_cost) : '—'}
                                                </td>
                                                <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-slate-100">
                                                    {formatCurrency(line.landed_line_total)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* The same ladder the Goods Receipt screen prints, in the same order,
                                so the two screens can be read side by side against the supplier's
                                paper. The AP-specific figures — what this payable should be, and
                                how far off it is — sit at the bottom where the clerk needs them. */}
                            <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-sm">
                                <div className="w-full sm:max-w-md sm:ml-auto space-y-1">
                                    <TotalRow label="Goods as delivered" value={totals.gross_as_delivered} />
                                    {num(totals.line_discount_total) > 0 && (
                                        <TotalRow label="Less line discounts" value={totals.line_discount_total} sign="−" />
                                    )}
                                    {num(totals.header_discount_total) > 0 && (
                                        <TotalRow
                                            label="Less overall discount"
                                            value={totals.header_discount_total}
                                            sign="−"
                                            tip="A reduction the supplier gave on the invoice total, spread across the lines in proportion to their value."
                                        />
                                    )}
                                    <div className="flex justify-between items-baseline py-1.5 my-1 px-2 -mx-2 rounded bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
                                        <span className="font-semibold text-primary-900 dark:text-primary-200 inline-flex items-center gap-1">
                                            Supplier invoice total
                                            <InfoTip label="Supplier invoice total">
                                                What the supplier&apos;s own invoice should say: everything as delivered,
                                                before anything was sent back. Check it against the paper first — if this
                                                matches and the payable does not, the difference is a return.
                                            </InfoTip>
                                        </span>
                                        <span className="font-mono font-bold text-base text-primary-900 dark:text-primary-200">
                                            {formatCurrency(totals.supplier_invoice_total)}
                                        </span>
                                    </div>
                                    {hasReturns && (
                                        <>
                                            <TotalRow label="Less returned / rejected" value={totals.returned_value} sign="−" tone="warn" />
                                            <TotalRow label="Payable to supplier" value={totals.net_goods_value} tone="strong" strong />
                                        </>
                                    )}
                                    {num(totals.freight_amount) > 0 && (
                                        <TotalRow
                                            label="Plus freight (billed to carrier)"
                                            value={totals.freight_amount}
                                            sign="+"
                                            tip="Freight is capitalised into the cost of the stock, but it is owed to the carrier on a separate payable — not to the goods supplier."
                                        />
                                    )}
                                    <TotalRow label="Value added to stock" value={totals.total_inventory_value} tone="strong" strong />

                                    <div className="pt-2 mt-2 border-t border-gray-200 dark:border-slate-700 space-y-1">
                                        <div className="flex justify-between">
                                            <span className="inline-flex items-center gap-1 text-gray-600 dark:text-slate-400">
                                                {isFreight ? 'Freight charged on this receipt' : 'This bill should be'}
                                                <InfoTip label={isFreight ? 'Freight charged' : 'This bill should be'}>
                                                    {isFreight
                                                        ? 'This payable is the carrier’s, so it should match the freight charged on the receipt, not the value of the goods carried.'
                                                        : 'What the receipt made us owe the goods supplier: accepted quantity only, after line and overall discounts, freight excluded.'}
                                                </InfoTip>
                                            </span>
                                            <span className="font-mono text-gray-900 dark:text-slate-100">{formatCurrency(expected)}</span>
                                        </div>
                                        {receipts.length === 1 && (
                                            <div className="flex justify-between font-medium">
                                                <span className="text-gray-700 dark:text-slate-300">Variance vs bill total</span>
                                                <span className={Math.abs(variance) > 0.005
                                                    ? 'font-mono text-danger-600 dark:text-danger-400'
                                                    : 'font-mono text-success-600 dark:text-success-400'}>
                                                    {formatCurrency(variance)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {!loading && receipts.length > 1 && (
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                        This payable has more than one receipt behind it, so no single receipt is expected
                        to match the bill total on its own.
                    </p>
                )}

                <div className="flex justify-end pt-1">
                    <button type="button" onClick={onClose}
                        className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">
                        Close
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default BillGoodsReceiptsModal;
