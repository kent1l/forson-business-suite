import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

const secureStoreStorage = {
  getItem: async (name) => {
    try {
      const value = await SecureStore.getItemAsync(name);
      return value || null;
    } catch (error) {
      console.error('Failed to get item from SecureStore:', error);
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await SecureStore.setItemAsync(name, value);
    } catch (error) {
      console.error('Failed to set item in SecureStore:', error);
    }
  },
  removeItem: async (name) => {
    try {
      await SecureStore.deleteItemAsync(name);
    } catch (error) {
      console.error('Failed to delete item from SecureStore:', error);
    }
  },
};

const useSettingsStore = create(
  persist(
    (set) => ({
      serverIp: '',
      setServerIp: (ip) => set({ serverIp: ip }),
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => secureStoreStorage),
    }
  )
);

export default useSettingsStore;
