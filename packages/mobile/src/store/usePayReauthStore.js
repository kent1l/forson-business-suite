import { create } from 'zustand';

/** How long a password confirmation covers My Pay before it's asked for again. */
export const PAY_REAUTH_WINDOW_MS = 15 * 60 * 1000;

/**
 * Tracks when the signed-in user last confirmed their password for My Pay.
 *
 * Deliberately in-memory only, not persisted to disk or SecureStore: a fresh
 * app launch should always ask again, the same as the window lapsing. Reset
 * on logout (see useAuthStore) so the next person on a shared phone can't
 * inherit the previous employee's unlocked state.
 */
const usePayReauthStore = create((set, get) => ({
  unlockedAt: null,

  unlock: () => set({ unlockedAt: Date.now() }),
  lock: () => set({ unlockedAt: null }),

  isUnlocked: () => {
    const { unlockedAt } = get();
    return !!unlockedAt && Date.now() - unlockedAt < PAY_REAUTH_WINDOW_MS;
  },
}));

export default usePayReauthStore;
