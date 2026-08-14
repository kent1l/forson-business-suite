import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';

const STORAGE_KEY = 'brand_theme';

/**
 * Brand colours pulled from the server.
 *
 * `GET /api/branding/theme` is deliberately unauthenticated on the API side so
 * the login screen can theme itself, which means this can load before anyone
 * signs in. The last successful response is cached so a phone opening offline
 * still shows the right brand rather than falling back to the built-in blue.
 *
 * Purely cosmetic, so every failure path here is silent: a wrong accent colour
 * is not worth an error message, and never worth blocking the app.
 */
const useBrandStore = create((set) => ({
  colors: null,
  isHydrated: false,

  hydrate: async () => {
    try {
      const cached = await AsyncStorage.getItem(STORAGE_KEY);
      set({ colors: cached ? JSON.parse(cached) : null, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  refresh: async () => {
    try {
      const { data } = await apiClient.get('/branding/theme');
      const colors = {
        light: {
          primary: data.BRAND_PRIMARY_COLOR || null,
          accent: data.BRAND_ACCENT_COLOR || null,
        },
        dark: {
          // The web app falls back to the light value when no dark override is
          // configured, so mobile does the same rather than inventing one.
          primary: data.BRAND_PRIMARY_COLOR_DARK || data.BRAND_PRIMARY_COLOR || null,
          accent: data.BRAND_ACCENT_COLOR_DARK || data.BRAND_ACCENT_COLOR || null,
        },
      };
      set({ colors });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    } catch {
      // Offline, or no server configured yet. Keep whatever is cached.
    }
  },

  clear: async () => {
    set({ colors: null });
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* nothing to lose */ }
  },
}));

export default useBrandStore;
