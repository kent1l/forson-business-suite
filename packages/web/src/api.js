import axios from 'axios';
import toast from 'react-hot-toast'; // Import toast

const api = axios.create({
    baseURL: 'http://localhost:3001/api',
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

// NEW: Response interceptor for global error handling
api.interceptors.response.use(
    (response) => response, // Directly return successful responses
    (error) => {
        // Check if the error is a 401 Unauthorized response
        if (error.response && error.response.status === 401) {
            // Clear the user session from local storage
            localStorage.removeItem('userSession');
            // Show a toast notification to the user
            toast.error('Session expired. Please log in again.');
            // Reload the application
            window.location.href = '/'; 
        }
        // For all other errors, just pass them along
        return Promise.reject(error);
    }
);


export default api;