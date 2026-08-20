/* eslint-disable no-unused-vars */
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function SavedSalesPanel({ saved, onRestore, onDelete, currency='₱' }) {
  if (!saved.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Icon path={ICONS.bookmark} className="h-12 w-12 text-gray-300 dark:text-slate-600 mb-4" />
        <p className="text-gray-500 dark:text-slate-400 text-sm">No saved sales yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-2 overflow-y-auto">
      {saved.map(s => {
        const itemCount = s.cart?.items?.length || 0;
        const total = s.cart?.totals?.grandTotal ?? s.cart?.totals?.total ?? 0;
        return (
          <div key={s.id} className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800 shadow-sm flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">{s.label}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{new Date(s.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
              </div>
              <button onClick={() => onDelete(s.id)} className="text-danger-500 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300" title="Delete">
                <Icon path={ICONS.trash} className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-gray-600 dark:text-slate-300 mb-3">{itemCount} item{itemCount!==1 && 's'} • {currency}{Number(total).toFixed(2)}</div>
            <button onClick={() => onRestore(s.id)} className="mt-auto bg-primary-600 text-white py-2 rounded-md text-sm font-medium hover:bg-primary-700 transition">Restore</button>
          </div>
        );
      })}
    </div>
  );
}
