import { useEffect, useState } from 'react';
import api from '../api';

// Select the physical box explicitly; visiting Cash Box is not a prerequisite
// for paying a customer or collecting the difference on an exchange.
export default function useCashDrawerSession(required) {
    const [sessions, setSessions] = useState([]);
    const [sessionId, setSessionId] = useState('');
    const [enabled, setEnabled] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!required) return;
        let cancelled = false;
        setEnabled(null);
        setError('');
        api.get('/cash-drawers').then(response => {
            if (cancelled) return;
            const open = (response.data.data || []).filter(item => item.status === 'OPEN' && item.session_id);
            setSessions(open);
            setSessionId(previous => open.some(item => String(item.session_id) === previous)
                ? previous : open.length === 1 ? String(open[0].session_id) : '');
            setEnabled(true);
        }).catch(err => {
            if (cancelled) return;
            if (err.response?.data?.code === 'CASH_DRAWER_DISABLED') setEnabled(false);
            else setError(err.response?.data?.message || 'Unable to load cash drawers. Try reopening this form.');
        });
        return () => { cancelled = true; };
    }, [required]);
    const validationError = !required || enabled === false ? null : error || (enabled === null
        ? 'Loading cash drawers…' : !sessionId ? 'Select an open cash drawer for this transaction.' : null);
    return { sessions, sessionId, setSessionId, enabled, validationError };
}
