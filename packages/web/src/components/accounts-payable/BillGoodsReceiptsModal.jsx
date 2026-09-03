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

const LINK_LABEL = {
    goods: 'Goods',
    freight: 'Freight',
};

/**
 * The goods receipt(s) a payable is charging for, read-only.
 *
 * A bill and a receipt are two views of the same delivery — one says what we owe,
 * the other says what actually arrived — and the question an AP clerk asks before
 * paying is whether they agree. This is the answer without a detour through the
 * Goods Receipt module, which needs its own permissions and is built for editing
 * receipts rather than checking one against an invoice.
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
            maxWidth="max-w-4xl"
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
                    const expected = isFreight ? Number(grn.freight_amount) : Number(grn.goods_value);
                    const variance = Number(bill.total_amount) - expected;
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
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="text-left text-xs uppercase text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800">
                                        <tr>
                                            <th className="px-4 py-2 font-semibold">Item</th>
                                            <th className="px-4 py-2 font-semibold text-right">Received</th>
                                            <th className="px-4 py-2 font-semibold text-right">Rejected</th>
                                            <th className="px-4 py-2 font-semibold text-right">Unit Cost</th>
                                            <th className="px-4 py-2 font-semibold text-right">Landed</th>
                                            <th className="px-4 py-2 font-semibold text-right">Line Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                        {grn.lines.length === 0 && (
                                            <tr><td colSpan={6} className="px-4 py-4 text-center text-gray-500 dark:text-slate-400">This receipt has no lines.</td></tr>
                                        )}
                                        {grn.lines.map((line) => {
                                            const accepted = Number(line.quantity) - Number(line.return_quantity || 0);
                                            return (
                                                <tr key={line.grn_line_id}>
                                                    <td className="px-4 py-2 text-gray-900 dark:text-slate-100">
                                                        {line.display_name}
                                                        {line.rejection_reason && (
                                                            <span className="block text-xs text-danger-600 dark:text-danger-400">
                                                                Rejected: {line.rejection_reason}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtQty(line.quantity)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-gray-500 dark:text-slate-400">
                                                        {Number(line.return_quantity) > 0 ? fmtQty(line.return_quantity) : '—'}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{formatCurrency(line.cost_price)}</td>
                                                    <td className="px-4 py-2 text-right font-mono text-gray-500 dark:text-slate-400">
                                                        {line.landed_unit_cost != null ? formatCurrency(line.landed_unit_cost) : '—'}
                                                    </td>
                                                    <td className="px-4 py-2 text-right font-mono text-gray-900 dark:text-slate-100">
                                                        {formatCurrency(accepted * Number(line.cost_price))}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 space-y-1 text-sm">
                                <div className="flex justify-between text-gray-600 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                        {isFreight ? 'Freight charged on this receipt' : 'Accepted goods value'}
                                        <InfoTip label={isFreight ? 'Freight charged' : 'Accepted goods value'}>
                                            {isFreight
                                                ? 'This payable is the carrier’s, so it should match the freight charged on the receipt, not the value of the goods carried.'
                                                : 'Quantity received less anything rejected at the dock, at the supplier’s unit cost. Rejected stock never entered the building, so it is not billable.'}
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
