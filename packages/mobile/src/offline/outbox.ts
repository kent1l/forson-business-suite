import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import useAuthStore from '../store/useAuthStore';
import type { OutboxEntry, OutboxKind } from './mutations';
import { MAX_ATTEMPTS, applyAttempt, pendingEntries } from './queueLogic';

const STORAGE_KEY = 'offline_outbox_v1';

/**
 * The queue of writes waiting for the server.
 *
 * Deliberately in AsyncStorage rather than SecureStore, which the rest of the
 * app uses for the token. SecureStore is backed by Android's keystore and is
 * meant for small secrets -- it has a practical per-item size limit around a
 * couple of kilobytes, which a growing queue of counts would blow through. The
 * queue holds no credentials, so plain storage is the right tool.
 *
 * Entries are never dropped silently. One that exhausts its attempts becomes
 * `needs-attention` and stays visible until the user retries or discards it: a
 * clock-in that vanished without telling anyone is worse than one that is
 * plainly stuck.
 */

type OutboxState = {
  entries: OutboxEntry[];
  isHydrated: boolean;
  /** Set when a 401 halted the drain; cleared on the next successful login. */
  pausedForAuth: boolean;

  hydrate: () => Promise<void>;
  enqueue: (kind: OutboxKind, body: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<OutboxEntry>;
  remove: (id: string) => Promise<void>;
  update: (id: string, patch: Partial<OutboxEntry>) => Promise<void>;
  markAttempt: (id: string, error: string) => Promise<void>;
  retryAll: () => Promise<void>;
  setPausedForAuth: (paused: boolean) => void;
  clear: () => Promise<void>;
};

const persist = async (entries: OutboxEntry[]) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('Failed to persist outbox', e);
  }
};

const useOutboxStore = create<OutboxState>((set, get) => ({
  entries: [],
  isHydrated: false,
  pausedForAuth: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      set({ entries: raw ? JSON.parse(raw) : [], isHydrated: true });
    } catch (e) {
      console.warn('Failed to hydrate outbox', e);
      set({ isHydrated: true });
    }
  },

  enqueue: async (kind, body, meta) => {
    const entry: OutboxEntry = {
      id: Crypto.randomUUID(),
      kind,
      ownerEmployeeId: useAuthStore.getState().user?.employee_id ?? null,
      body,
      meta,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      status: 'pending',
    };
    const entries = [...get().entries, entry];
    set({ entries });
    await persist(entries);
    return entry;
  },

  remove: async (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries });
    await persist(entries);
  },

  update: async (id, patch) => {
    const entries = get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    set({ entries });
    await persist(entries);
  },

  markAttempt: async (id, error) => {
    const entries = get().entries.map((e) => (e.id === id ? applyAttempt(e, error) : e));
    set({ entries });
    await persist(entries);
  },

  retryAll: async () => {
    const entries = get().entries.map((e) => ({
      ...e, status: 'pending' as const, attempts: 0, lastError: null,
    }));
    set({ entries });
    await persist(entries);
  },

  setPausedForAuth: (paused) => set({ pausedForAuth: paused }),

  clear: async () => {
    set({ entries: [] });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
}));

export { MAX_ATTEMPTS, pendingEntries };
export default useOutboxStore;
