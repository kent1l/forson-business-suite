/* eslint-disable no-unused-vars */
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function SavedSalesPanel({ saved, onRestore, onDelete, currency='₱' }) {
  if (!saved.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Icon path={ICONS.bookmark} className="h-12 w-12 text-gray-300 mb-4" />
        <p className="text-gray-500 text-sm">No saved sales yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-2 overflow-y-auto">
      {saved.map(s => {
        const itemCount = s.cart?.items?.length || 0;
        const total = s.cart?.totals?.grandTotal ?? s.cart?.totals?.total ?? 0;
        return (
          <div key={s.id} className="border rounded-lg p-4 bg-white shadow-sm flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-semibold text-sm">{s.label}</div>
                <div className="text-[11px] text-gray-500">{new Date(s.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
              </div>
              <button onClick={() => onDelete(s.id)} className="text-red-500 hover:text-red-700" title="Delete">
                <Icon path={ICONS.trash} className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-gray-600 mb-3">{itemCount} item{itemCount!==1 && 's'} • {currency}{Number(total).toFixed(2)}</div>
            <button onClick={() => onRestore(s.id)} className="mt-auto bg-blue-600 text-white py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition">Restore</button>
          </div>
        );
      })}
    </div>
  );
}
