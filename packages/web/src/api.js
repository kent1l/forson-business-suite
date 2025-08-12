import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
    // UPDATED: The base URL is now relative.
    baseURL: '/api', 
    headers: {
        'Content-Type': 'application/json'
    }
});

// Request interceptor remains the same
api.interceptors.request.use(config => {
    const sessionData = JSON.parse(localStorage.getItem('userSession'));
    if (sessionData && sessionData.token) {
        config.headers.Authorization = `Bearer ${sessionData.token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

// Response interceptor for global error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            localStorage.removeItem('userSession');
            toast.error('Session expired. Please log in again.');
            window.location.href = '/'; 
        }
        return Promise.reject(error);
    }
);

export default api;