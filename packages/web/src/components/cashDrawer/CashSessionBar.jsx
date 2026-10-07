import { useEffect, useState } from 'react';
import api from '../../api';

const STORAGE_KEY = 'forson_cash_drawer_session';

const CASH_WORKFLOW_PAGES = new Set(['pos', 'invoicing', 'staged_sales', 'sales_history', 'ar', 'ap', 'expenses']);

export default function CashSessionBar({ onNavigate, currentPage }) {
    const [drawers, setDrawers] = useState(null);
    const [selected, setSelected] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        if (!CASH_WORKFLOW_PAGES.has(currentPage)) return undefined;
        let live = true;
        const refresh = async () => {
            try {
                const response = await api.get('/cash-drawers');
                if (!live) return;
                const active = (response.data?.data || []).filter(drawer => drawer.status === 'OPEN');
                setDrawers(active);
                setLoadError(false);
                if (!active.some(drawer => String(drawer.session_id) === String(sessionStorage.getItem(STORAGE_KEY)))) {
                    sessionStorage.removeItem(STORAGE_KEY);
                    setSelected('');
                }
            } catch (error) {
                if (!live) return;
                if ([403, 503].includes(error.response?.status)) {
                    sessionStorage.removeItem(STORAGE_KEY);
                    setSelected('');
                    setDrawers(null);
                } else setLoadError(true);
            }
        };
        refresh();
        window.addEventListener('focus', refresh);
        window.addEventListener('cash-drawer-updated', refresh);
        return () => { live = false; window.removeEventListener('focus', refresh); window.removeEventListener('cash-drawer-updated', refresh); };
    }, [currentPage]);

    if (drawers === null || !CASH_WORKFLOW_PAGES.has(currentPage)) return null;
    if (loadError) return <div role="alert" className="border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">Unable to check the open cash drawer. Refresh before recording a cash payment.</div>;
    if (drawers.length === 0) return (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <p><strong>No cash drawer session is open.</strong> Count the opening cash and open a session before recording a cash payment.</p>
            <button type="button" className="min-h-11 rounded px-3 font-semibold underline" onClick={() => onNavigate('cash_drawer')}>Open Cash Drawer</button>
        </div>
    );
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <label className="flex flex-wrap items-center gap-2 font-medium">
                Cash payment destination
                <select aria-label="Open drawer session for cash payments" className="min-h-11 rounded border border-amber-400 bg-white px-2 text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-white"
                    value={selected} onChange={event => {
                        const value = event.target.value;
                        setSelected(value);
                        if (value) sessionStorage.setItem(STORAGE_KEY, value);
                        else sessionStorage.removeItem(STORAGE_KEY);
                    }}>
                    <option value="">Select an open drawer session</option>
                    {drawers.map(drawer => <option key={drawer.session_id} value={drawer.session_id}>{drawer.name} · {drawer.business_date}</option>)}
                </select>
                <span className="font-normal">Choose where cash goes before recording a cash sale or payment. Card and other noncash payments do not affect the drawer.</span>
            </label>
            <button type="button" className="min-h-11 rounded px-3 font-semibold underline" onClick={() => onNavigate('cash_drawer')}>View drawer balance</button>
        </div>
    );
}
