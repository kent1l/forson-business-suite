import { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import PaginationControls from '../ui/PaginationControls';
import { formatCurrency } from '../../utils/currency';

const statusClass = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'paid') return 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400';
    if (normalized === 'cancelled') return 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400';
    return 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400';
};

const CustomerPurchaseHistoryModal = ({ customer, isOpen, onClose }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [selectedTransaction, setSelectedTransaction] = useState(null);
    const [lines, setLines] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);

    useEffect(() => { setPage(1); }, [customer?.customer_id, isOpen]);

    useEffect(() => {
        if (!isOpen || !customer?.customer_id) return;
        let cancelled = false;
        setLoading(true);
        api.get(`/customers/${customer.customer_id}/purchase-history`, { params: { paginated: 1, page, pageSize } })
            .then(({ data }) => {
                if (cancelled) return;
                setHistory(data?.data || []);
                setTotal(data?.total || 0);
            })
            .catch(() => { if (!cancelled) toast.error('Failed to load purchase history.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [customer?.customer_id, isOpen, page, pageSize]);

    const openTransaction = async (transaction) => {
        setSelectedTransaction(transaction);
        setDetailsLoading(true);
        try {
            const { data } = await api.get(`/customers/${customer.customer_id}/purchase-history/${transaction.invoice_id}`);
            setLines(data || []);
        } catch {
            toast.error('Failed to load transaction details.');
            setLines([]);
        } finally {
            setDetailsLoading(false);
        }
    };

    const customerName = customer?.company_name || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Customer';
    return <>
        <Modal isOpen={isOpen} onClose={onClose} title={`Purchase history — ${customerName}`} maxWidth="max-w-5xl">
            {loading ? <p className="py-8 text-center text-gray-500 dark:text-slate-400">Loading purchase history...</p>
                : history.length === 0 ? <p className="py-8 text-center text-gray-500 dark:text-slate-400">No purchases have been recorded for this customer.</p>
                    : <>
                        <p className="text-sm text-gray-500 dark:text-slate-400">Select a transaction to review its items.</p>
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-700/40 dark:text-slate-300"><tr>
                                    <th className="p-3 text-sm font-semibold">Transaction</th><th className="p-3 text-sm font-semibold">Date</th><th className="p-3 text-sm font-semibold">Receipt #</th><th className="p-3 text-right text-sm font-semibold">Net total</th><th className="p-3 text-center text-sm font-semibold">Status</th>
                                </tr></thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                    {history.map(transaction => <tr key={transaction.invoice_id} onClick={() => openTransaction(transaction)} className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                        <td className="p-3 font-mono text-sm font-medium text-primary-700 dark:text-primary-300">{transaction.invoice_number}</td><td className="p-3 text-sm text-gray-700 dark:text-slate-300">{new Date(transaction.invoice_date).toLocaleDateString()}</td><td className="p-3 font-mono text-sm text-gray-700 dark:text-slate-300">{transaction.physical_receipt_no || '—'}</td><td className="p-3 text-right font-mono text-sm text-gray-900 dark:text-slate-100">{formatCurrency(transaction.net_amount)}</td><td className="p-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(transaction.status)}`}>{transaction.status}</span></td>
                                    </tr>)}
                                </tbody>
                            </table>
                        </div>
                        <PaginationControls page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
                    </>}
        </Modal>
        <Modal isOpen={!!selectedTransaction} onClose={() => { setSelectedTransaction(null); setLines([]); }} title={`Transaction ${selectedTransaction?.invoice_number || ''}`} maxWidth="max-w-3xl" zIndexClass="z-50">
            {detailsLoading ? <p className="py-8 text-center text-gray-500 dark:text-slate-400">Loading transaction details...</p> : <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-gray-500 dark:text-slate-400">Date</span><p className="font-medium">{selectedTransaction && new Date(selectedTransaction.invoice_date).toLocaleDateString()}</p></div><div><span className="text-gray-500 dark:text-slate-400">Total</span><p className="font-medium">{formatCurrency(selectedTransaction?.net_amount)}</p></div></div>
                {lines.length === 0 ? <p className="py-4 text-center text-gray-500 dark:text-slate-400">No line items found for this transaction.</p> : <div className="overflow-x-auto"><table className="w-full text-left"><thead className="border-b border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"><tr><th className="p-2 text-sm">Item</th><th className="p-2 text-right text-sm">Qty</th><th className="p-2 text-right text-sm">Unit price</th><th className="p-2 text-right text-sm">Line total</th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">{lines.map(line => <tr key={line.invoice_line_id}><td className="p-2 text-sm"><p className="font-medium text-gray-900 dark:text-slate-100">{line.display_name || line.detail}</p>{line.part_numbers && <p className="text-xs text-gray-500 dark:text-slate-400">{line.part_numbers}</p>}</td><td className="p-2 text-right font-mono text-sm">{Number(line.quantity)}</td><td className="p-2 text-right font-mono text-sm">{formatCurrency(line.sale_price)}</td><td className="p-2 text-right font-mono text-sm font-medium">{formatCurrency(Number(line.quantity) * Number(line.sale_price) - Number(line.discount_amount || 0))}</td></tr>)}</tbody></table></div>}
            </div>}
        </Modal>
    </>;
};

export default CustomerPurchaseHistoryModal;
