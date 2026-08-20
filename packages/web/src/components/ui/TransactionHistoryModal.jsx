import { useState, useEffect } from 'react';
import api from '../../api';
import Modal from './Modal';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TransactionHistoryModal = ({ part, isOpen, onClose }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && part) {
            const fetchHistory = async () => {
                setLoading(true);
                try {
                    const response = await api.get(`/inventory/${part.part_id}/history`);
                    setHistory(response.data);
                } catch (err) {
                    console.error("Failed to fetch transaction history", err);
                } finally {
                    setLoading(false);
                }
            };
            fetchHistory();
        }
    }, [isOpen, part]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Transaction History for ${part?.detail}`} maxWidth="max-w-3xl">
            <div className="max-h-[60vh] overflow-y-auto">
                {loading ? <p className="text-gray-500 dark:text-slate-400 py-4 text-center">Loading history...</p> : (
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300">
                            <tr>
                                <th className="p-2.5">Date</th>
                                <th className="p-2.5">Type</th>
                                <th className="p-2.5 text-center">Qty</th>
                                <th className="p-2.5">Reference</th>
                                <th className="p-2.5">Notes</th>
                                <th className="p-2.5">User</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                            {history.map(tx => (
                                <tr key={tx.inv_trans_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                    <td className="p-2.5 whitespace-nowrap text-gray-600 dark:text-slate-400">{format(toZonedTime(parseISO(tx.transaction_date), 'Asia/Manila'), 'MM/dd/yyyy hh:mm a')}</td>
                                    <td className="p-2.5 font-medium">{tx.trans_type}</td>
                                    <td className={`p-2.5 text-center font-semibold ${tx.quantity > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                                        {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                                    </td>
                                    <td className="p-2.5 text-gray-600 dark:text-slate-400">{tx.reference_no || '-'}</td>
                                    <td className="p-2.5 text-gray-600 dark:text-slate-400">{tx.notes || '-'}</td>
                                    <td className="p-2.5 whitespace-nowrap text-gray-600 dark:text-slate-400">{tx.first_name || '-'}</td>
                                </tr>
                            ))}
                            {history.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-6 text-center text-gray-500 dark:text-slate-400">
                                        No transaction history found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </Modal>
    );
};

export default TransactionHistoryModal;
