import React from 'react';
import { formatCurrency } from '../../utils/currency';

const CustomerWalletBadge = ({ balance, onClick }) => {
  const numBalance = parseFloat(balance) || 0;
  if (numBalance <= 0) return null;

  return (
    <button
      onClick={onClick}
      type="button"
      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors shadow-xs"
      title="Click to view Customer Store Credit details"
    >
      <svg className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
      <span>Wallet: {formatCurrency(numBalance)}</span>
    </button>
  );
};

export default CustomerWalletBadge;
