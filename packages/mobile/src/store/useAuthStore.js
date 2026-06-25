import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const useAuthStore = create((set) => ({
  user: null,
  token: null,
  isHydrated: false,

  // Hydrate store from SecureStore on app launch
  hydrate: async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      const userStr = await SecureStore.getItemAsync('auth_user');

      set({
        token: token || null,
        user: userStr ? JSON.parse(userStr) : null,
        isHydrated: true
      });
    } catch (e) {
      console.error('Failed to hydrate auth store', e);
      set({ isHydrated: true });
    }
  },

  login: async (token, userData) => {
    try {
      await SecureStore.setItemAsync('auth_token', token);
      await SecureStore.setItemAsync('auth_user', JSON.stringify(userData));
      set({ token, user: userData });
    } catch (e) {
      console.error('Failed to save auth data', e);
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('auth_user');
      set({ token: null, user: null });
    } catch (e) {
      console.error('Failed to clear auth data', e);
    }
  }
}));

export default useAuthStore;
