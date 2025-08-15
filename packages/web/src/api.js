import axios from 'axios';
import toast from 'react-hot-toast';

// Create a simple event emitter to notify the app of auth errors
const authErrorEvent = new Event('auth-error');

const api = axios.create({
    baseURL: '/api', 
    headers: {
        'Content-Type': 'application/json'
    }
});

api.interceptors.request.use(config => {
    const sessionData = JSON.parse(localStorage.getItem('userSession'));
    if (sessionData && sessionData.token) {
        config.headers.Authorization = `Bearer ${sessionData.token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

// UPDATED: Response interceptor to dispatch an event instead of reloading
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            // Don't handle the logout here directly.
            // Instead, dispatch a global event that the React app can listen for.
            toast.error('Session expired. Please log in again.');
            window.dispatchEvent(authErrorEvent);
        }
        return Promise.reject(error);
    }
);

export default api;
