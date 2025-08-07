import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:3001/api',
    headers: {
        'Content-Type': 'application/json'
    }
});

// This "interceptor" runs before every request
api.interceptors.request.use(config => {
    // 1. Get the full session data from localStorage
    const sessionData = JSON.parse(localStorage.getItem('userSession'));
    
    // 2. If the session and token exist, add the token to the request header
    if (sessionData && sessionData.token) {
        config.headers.Authorization = `Bearer ${sessionData.token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

export default api;
