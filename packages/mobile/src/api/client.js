import axios from 'axios';
import useAuthStore from '../store/useAuthStore';
import * as SecureStore from 'expo-secure-store';

// We use process.env.EXPO_PUBLIC_API_URL if it exists, otherwise default to localhost (useful for simulators)
// Note: For physical devices testing against local dev server, you must set EXPO_PUBLIC_API_URL to your machine's local IP (e.g., http://192.168.1.100:3000/api)
const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

const apiClient = axios.create({
  baseURL,
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
