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
const pendingCashSourceKeys = new Map();

api.interceptors.request.use(config => {
    const sessionData = JSON.parse(localStorage.getItem('userSession'));
    if (sessionData && sessionData.token) {
        config.headers.Authorization = `Bearer ${sessionData.token}`;
    }
    const sourceWrite = config.method?.toLowerCase() === 'post' &&
        /^\/(invoices(?:\/\d+\/payments|\/exchange)?|payments|sales\/staging\/\d+\/approve-post|ap\/payments|expenses|refunds)$/.test(config.url || '');
    if (sourceWrite && config.data && typeof config.data === 'object' && !Array.isArray(config.data)) {
        const cashSessionId = sessionStorage.getItem('forson_cash_drawer_session');
        if (cashSessionId && !config.data.cash_session_id) config.data.cash_session_id = cashSessionId;
        const signature = `${config.method}:${config.url}:${JSON.stringify(config.data)}`;
        if (!pendingCashSourceKeys.has(signature)) pendingCashSourceKeys.set(signature, createUuid());
        config.headers['Idempotency-Key'] ||= pendingCashSourceKeys.get(signature);
        config.cashSourceSignature = signature;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

// UPDATED: Response interceptor to dispatch an event instead of reloading
api.interceptors.response.use(
    (response) => {
        if (response.config?.cashSourceSignature) pendingCashSourceKeys.delete(response.config.cashSourceSignature);
        return response;
    },
    (error) => {
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
