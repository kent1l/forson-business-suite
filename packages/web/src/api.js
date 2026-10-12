import axios from 'axios';
import toast from 'react-hot-toast';
import { createUuid } from './utils/createUuid';

// Create a CustomEvent to notify the app of auth errors
const authErrorEvent = (detail = {}) => new CustomEvent('auth-error', { detail });

const api = axios.create({
    baseURL: '/api', 
    headers: {
        'Content-Type': 'application/json'
    }
});
const pendingPrefix = 'cash-source-pending:';
// Remove legacy close drafts immediately when the API client loads, including
// drafts belonging to a previous sign-in. Keep only the key needed to reconcile.
try {
    for (const key of Object.keys(sessionStorage).filter(item => item.startsWith('cash-box-write:'))) {
        const raw = sessionStorage.getItem(key);
        if (!raw || !/recipient_password|ack_token/.test(raw)) continue;
        try {
            const saved = JSON.parse(raw);
            sessionStorage.setItem(key, JSON.stringify({ key: saved.key, path: saved.path, reconcileOnly: true }));
        } catch { sessionStorage.removeItem(key); }
    }
} catch { /* The Cash Box disables financial submission when storage is unavailable. */ }
const secretField = /password|token|secret|credential/i;
function hasSecret(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => secretField.test(key) || hasSecret(child));
}
function sourcePending(actor) {
    const matches = Object.keys(sessionStorage).filter(key => key.startsWith(pendingPrefix));
    const own = matches.find(key => key === `${pendingPrefix}${actor}`);
    return own ? JSON.parse(sessionStorage.getItem(own)) : null;
}


api.interceptors.request.use(async config => {
    const sessionData = JSON.parse(localStorage.getItem('userSession') || 'null');
    if (sessionData?.token) config.headers.Authorization = `Bearer ${sessionData.token}`;
    const sourceWrite = config.method?.toLowerCase() === 'post' &&
        /^\/(invoices(?:\/\d+\/payments|\/exchange)?|payments|sales\/staging\/\d+\/approve-post|ap\/payments|expenses|refunds)$/.test(config.url || '');
    if (!sourceWrite || !config.data || typeof config.data !== 'object' || Array.isArray(config.data)) return config;
    const actor = sessionData?.user?.employee_id;
    if (!actor) throw new Error('Sign in before recording a cash source.');
    const cashSessionId = sessionStorage.getItem('forson_cash_drawer_session');
    if (cashSessionId && !config.data.cash_session_id) config.data.cash_session_id = cashSessionId;
    const isCash = !!(config.data.cash_session_id || config.data.notebook_receipt_id || config.data.funding_source === 'ADVANCE');
    if (!isCash) return config;
    if (hasSecret(config.data)) throw new Error('This cash request includes a credential and cannot be saved for safe retry.');
    const body = JSON.stringify(config.data);
    const path = config.url;
    const storageKey = `${pendingPrefix}${actor}`;
    let pending;
    try { pending = sourcePending(actor); }
    catch { throw new Error('Pending cash request storage is damaged. Reconcile with a manager before submitting another payment.'); }
    if (pending && (pending.path !== path || pending.body !== body)) {
        throw new Error('Resolve the previous cash payment before submitting a different one.');
    }
    const key = pending?.key || createUuid();
    if (pending) {
        try {
            const result = await axios.get(`/api/cash-drawers/requests/${key}`, {
                headers: { Authorization: `Bearer ${sessionData.token}` },
            });
            const record = result.data?.data;
            if (record?.status_code === 202) throw new Error('Cash source request is still pending. Ask a manager to reconcile it.');
            if (record) {
                sessionStorage.removeItem(storageKey);
                config.adapter = async () => ({
                    data: record.response, status: record.status_code, statusText: 'Reconciled',
                    headers: {}, config,
                });
                return config;
            }
        } catch (error) {
            if (error.message?.includes('still pending')) throw error;
            if (error.response?.status !== 404) throw new Error('Cash result is unknown. Reconciliation must succeed before another submission.');
        }
    }
    try { sessionStorage.setItem(storageKey, JSON.stringify({ actor, path, body, key })); }
    catch { throw new Error('Browser storage is unavailable. Cash payment was not sent.'); }
    config.headers['Idempotency-Key'] = key;
    config.cashSourceStorageKey = storageKey;
    return config;
}, error => Promise.reject(error));

// UPDATED: Response interceptor to dispatch an event instead of reloading
api.interceptors.response.use(
    (response) => {
        if (response.config?.cashSourceStorageKey) sessionStorage.removeItem(response.config.cashSourceStorageKey);
        return response;
    },
    (error) => {
        if (error.config?.cashSourceStorageKey && error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 401) {
            sessionStorage.removeItem(error.config.cashSourceStorageKey);
        }
        if (error.response && error.response.status === 401) {
            // Don't handle the logout here directly.
            // Instead, dispatch a global event that the React app can listen for.
            toast.error('Session expired. Please log in again.');
            window.dispatchEvent(authErrorEvent({ reason: 'unauthorized' }));
        }
        return Promise.reject(error);
    }
);

export default api;
