import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'settings_server_ip';

const useSettingsStore = create((set) => ({
  serverIp: '',
  isHydrated: false,

  hydrate: async () => {
    try {
      const ip = await SecureStore.getItemAsync(STORAGE_KEY);
      set({ serverIp: ip || '', isHydrated: true });
    } catch (error) {
      console.error('Failed to hydrate settings store:', error);
      set({ isHydrated: true });
    }
  },

  setServerIp: async (ip) => {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, ip);
      set({ serverIp: ip });
    } catch (error) {
      console.error('Failed to persist server IP:', error);
      // Still update in-memory state so the session works
      set({ serverIp: ip });
    }
  },
}));

export default useSettingsStore;
