import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Modal from './Modal';

const TransactionHistoryModal = ({ part, isOpen, onClose }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && part) {
            const fetchHistory = async () => {
                setLoading(true);
                try {
                    const response = await axios.get(`http://localhost:3001/api/inventory/${part.part_id}/history`);
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
                {loading ? <p>Loading history...</p> : (
                    <table className="w-full text-left text-sm">
                        <thead className="border-b">
                            <tr>
                                <th className="p-2">Date</th>
                                <th className="p-2">Type</th>
                                <th className="p-2 text-center">Qty</th>
                                <th className="p-2">Reference</th>
                                <th className="p-2">Notes</th>
                                <th className="p-2">User</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(tx => (
                                <tr key={tx.inv_trans_id} className="border-b">
                                    <td className="p-2 whitespace-nowrap">{new Date(tx.transaction_date).toLocaleString()}</td>
                                    <td className="p-2">{tx.trans_type}</td>
                                    <td className={`p-2 text-center font-semibold ${tx.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                                    </td>
                                    <td className="p-2">{tx.reference_no}</td>
                                    <td className="p-2">{tx.notes}</td>
                                    <td className="p-2 whitespace-nowrap">{tx.first_name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </Modal>
    );
};

export default TransactionHistoryModal;
