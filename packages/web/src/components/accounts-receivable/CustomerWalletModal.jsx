import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../../utils/currency';

const CustomerWalletModal = ({ customerId, customerName, isOpen, onClose, onWalletUpdated }) => {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAdjustForm, setShowAdjustForm] = useState(false);

  const fetchWallet = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await api.get(`/customers/${customerId}/wallet`);
      setWallet(res.data.wallet);
      setTransactions(res.data.transactions?.data || []);
    } catch (err) {
      console.error('Error fetching wallet:', err);
      toast.error('Failed to load customer wallet details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && customerId) {
      fetchWallet();
    }
  }, [isOpen, customerId]);

  const handleAdjustSubmit = async (e) => {
    e.preventDefault();
    const amountNum = parseFloat(adjustAmount);
    if (!amountNum || isNaN(amountNum)) {
      toast.error('Please enter a valid non-zero adjustment amount');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/customers/${customerId}/wallet/adjust`, {
        amount: amountNum,
        notes: adjustNotes || 'Manual wallet adjustment',
      });
      toast.success('Wallet balance adjusted successfully');
      setAdjustAmount('');
      setAdjustNotes('');
      setShowAdjustForm(false);
      await fetchWallet();
      if (onWalletUpdated) onWalletUpdated();
    } catch (err) {
      console.error('Error adjusting wallet:', err);
      toast.error(err.response?.data?.message || 'Failed to adjust wallet balance');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-100 transform transition-all">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold">Store Wallet & Credit Ledger</h3>
              <p className="text-xs text-slate-400">{customerName || `Customer #${customerId}`}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-slate-500 animate-pulse">Loading wallet balance and ledger history...</div>
          ) : (
            <>
              {/* Balance Summary Card */}
              <div className="bg-gradient-to-br from-indigo-50 to-slate-50 p-5 rounded-xl border border-indigo-100/60 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Available Store Credit Balance</span>
                  <div className="text-3xl font-extrabold text-slate-900 mt-1">
                    {formatCurrency(wallet?.balance || 0)}
                  </div>
                </div>
                <button
                  onClick={() => setShowAdjustForm(!showAdjustForm)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all"
                >
                  {showAdjustForm ? 'Cancel Adjustment' : 'Adjust Balance'}
                </button>
              </div>

              {/* Adjust Balance Form */}
              {showAdjustForm && (
                <form onSubmit={handleAdjustSubmit} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-fadeIn">
                  <h4 className="text-sm font-bold text-slate-800">Administrative Balance Adjustment</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Adjustment Amount (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. +100.00 or -50.00"
                        value={adjustAmount}
                        onChange={(e) => setAdjustAmount(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Reason / Reference Notes</label>
                      <input
                        type="text"
                        placeholder="e.g. Goodwill credit, Manual correction"
                        value={adjustNotes}
                        onChange={(e) => setAdjustNotes(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                    >
                      {submitting ? 'Processing...' : 'Confirm Adjustment'}
                    </button>
                  </div>
                </form>
              )}

              {/* Transaction Audit History Table */}
              <div>
                <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center justify-between">
                  <span>Transaction Audit Trail</span>
                  <span className="text-xs font-normal text-slate-500">{transactions.length} record(s)</span>
                </h4>
                {transactions.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-400 text-sm">
                    No transactions recorded for this wallet yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-64 border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 sticky top-0 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3 text-right">Balance After</th>
                          <th className="py-2.5 px-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {transactions.map((tx) => {
                          const isCredit = parseFloat(tx.amount) > 0;
                          return (
                            <tr key={tx.transaction_id} className="hover:bg-slate-50">
                              <td className="py-2 px-3 whitespace-nowrap text-slate-500">
                                {new Date(tx.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-2 px-3 font-medium">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                  tx.transaction_type === 'OVERPAYMENT_CREDIT' ? 'bg-emerald-100 text-emerald-800' :
                                  tx.transaction_type === 'INVOICE_PAYMENT_DRAWDOWN' ? 'bg-amber-100 text-amber-800' :
                                  tx.transaction_type === 'STORE_CREDIT_REFUND' ? 'bg-indigo-100 text-indigo-800' :
                                  'bg-slate-100 text-slate-800'
                                }`}>
                                  {tx.transaction_type}
                                </span>
                              </td>
                              <td className={`py-2 px-3 text-right font-bold ${isCredit ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {isCredit ? '+' : ''}{formatCurrency(tx.amount)}
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-slate-900">
                                {formatCurrency(tx.balance_after)}
                              </td>
                              <td className="py-2 px-3 text-slate-500 truncate max-w-xs">
                                {tx.notes || '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerWalletModal;
