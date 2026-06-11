import axios from 'axios';
import useAuthStore from '../store/useAuthStore';
import * as SecureStore from 'expo-secure-store';

const apiClient = axios.create({
  // Base URL pointing straight to the Proxmox server container layer
  baseURL: 'http://10.10.1.116:3001/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Attach JWT token if available
apiClient.interceptors.request.use(
  async (config) => {
    // Try getting the token from Zustand store first for performance
    let token = useAuthStore.getState().token;

    // If not in store, attempt to get from SecureStore (fallback)
    if (!token) {
      token = await SecureStore.getItemAsync('auth_token');
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: Handle 401 Unauthorized globally
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and user state, which will automatically redirect to login
      // if our navigation routing is observing this state (like in Expo Router).
      useAuthStore.getState().logout();
      console.warn('Session expired or unauthorized. Logging out.');
    }
    return Promise.reject(error);
  }
);

export default apiClient;
