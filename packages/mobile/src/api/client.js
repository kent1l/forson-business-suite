import axios from 'axios';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import * as SecureStore from 'expo-secure-store';

const apiClient = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Attach JWT token if available
apiClient.interceptors.request.use(
  async (config) => {
    const currentIp = useSettingsStore.getState().serverIp;
    if (!currentIp) {
      return Promise.reject(new Error('No server configured. Please set the server IP in Settings.'));
    }
    config.baseURL = currentIp.startsWith('http') ? `${currentIp}/api` : `http://${currentIp}/api`;

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
    if (error.response && error.response.status === 403) {
      console.warn('Permission denied:', error.response?.data?.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
