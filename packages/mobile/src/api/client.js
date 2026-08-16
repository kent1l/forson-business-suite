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

/**
 * Whether a failed request was an attempt to sign in, rather than a call made
 * with an existing session.
 *
 * Matched on the path so it cannot be fooled by a query string or by the
 * baseURL changing when the server address is reconfigured.
 */
const isAuthAttempt = (config) => {
  const url = config?.url ?? '';
  return /(^|\/)login\/?($|\?)/.test(url);
};

// Response interceptor: Handle 401 Unauthorized globally
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // A 401 from the login route means "those credentials are wrong", not
      // "your session ended". Treating the two the same tore down state that a
      // failed sign-in never established: logout() clears the persisted query
      // cache and cancels the pending clock-out reminder, so one mistyped
      // password -- on a shared phone, by someone who was not even signed in --
      // could cancel a colleague's reminder. It also logged a misleading
      // "Session expired" warning that sent us looking in the wrong place.
      //
      // The login screen surfaces this case itself, so the interceptor stays
      // out of the way and only reacts to a token that has genuinely stopped
      // being accepted.
      if (!isAuthAttempt(error.config)) {
        useAuthStore.getState().logout();
        console.warn('Session expired or unauthorized. Logging out.');
      }
    }
    if (error.response && error.response.status === 403) {
      console.warn('Permission denied:', error.response?.data?.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
