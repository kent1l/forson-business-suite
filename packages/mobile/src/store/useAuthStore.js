import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelClockOutReminder } from '../utils/clockOutReminder';
import usePayReauthStore from './usePayReauthStore';

/** Written by PersistQueryClientProvider; must not outlive the session. */
const QUERY_CACHE_KEY = 'REACT_QUERY_OFFLINE_CACHE';

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

  /**
   * Replaces the cached account from `GET /auth/me`.
   *
   * Permissions are re-read server-side on every request, so the copy held here
   * is only ever a hint for what the UI should offer. Refreshing it keeps the
   * client from showing actions the server will refuse -- or hiding ones it
   * would now allow.
   */
  updateUser: async (userData) => {
    try {
      await SecureStore.setItemAsync('auth_user', JSON.stringify(userData));
    } catch (e) {
      console.warn('Failed to persist refreshed user', e);
    }
    set({ user: userData });
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync('auth_token');
      await SecureStore.deleteItemAsync('auth_user');
      // The persisted query cache can hold whatever the last session read.
      // Leaving it behind would show one employee's data to the next person to
      // sign in on a shared phone.
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
      // Otherwise the next person on a shared phone is nudged about a shift
      // that was not theirs.
      await cancelClockOutReminder();
      // Same shared-phone concern as the reminder above: the next person to
      // sign in must not inherit an already-unlocked My Pay tab.
      usePayReauthStore.getState().lock();
      set({ token: null, user: null });
    } catch (e) {
      console.error('Failed to clear auth data', e);
      usePayReauthStore.getState().lock();
      set({ token: null, user: null });
    }
  }
}));

export default useAuthStore;
