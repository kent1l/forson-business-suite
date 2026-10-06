import { useEffect, useState } from 'react';
import api from '../../api';

const STORAGE_KEY = 'forson_cash_drawer_session';

export default function CashSessionBar({ onNavigate }) {
    const [drawers, setDrawers] = useState(null);
    const [selected, setSelected] = useState(() => sessionStorage.getItem(STORAGE_KEY) || '');

    useEffect(() => {
        let live = true;
        const refresh = async () => {
            try {
                const response = await api.get('/cash-drawers');
                if (!live) return;
                const active = (response.data?.data || []).filter(drawer => drawer.status === 'OPEN');
                setDrawers(active);
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
                } else setDrawers([]);
            }
        };
        refresh();
        window.addEventListener('focus', refresh);
        window.addEventListener('cash-drawer-updated', refresh);
        return () => { live = false; window.removeEventListener('focus', refresh); window.removeEventListener('cash-drawer-updated', refresh); };
    }, []);

    if (drawers === null) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <label className="flex items-center gap-2 font-medium">
                Physical cash drawer
                <select aria-label="Physical cash drawer for payments" className="min-h-11 rounded border border-amber-400 bg-white px-2 text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-white"
                    value={selected} onChange={event => {
                        const value = event.target.value;
                        setSelected(value);
                        if (value) sessionStorage.setItem(STORAGE_KEY, value);
                        else sessionStorage.removeItem(STORAGE_KEY);
                    }}>
                    <option value="">Select for physical cash payments</option>
                    {drawers.map(drawer => <option key={drawer.session_id} value={drawer.session_id}>{drawer.name} · {drawer.business_date}</option>)}
                </select>
            </label>
            <button type="button" className="min-h-11 rounded px-3 font-semibold underline" onClick={() => onNavigate('cash_drawer')}>Open drawer workspace</button>
        </div>
    );
}
