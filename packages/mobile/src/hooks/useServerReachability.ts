import { useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import axios from 'axios';
import { create } from 'zustand';
import useSettingsStore from '../store/useSettingsStore';

const POLL_MS = 20000;
const PROBE_TIMEOUT_MS = 4000;

export type Reachability = 'checking' | 'online' | 'offline';

/**
 * Backed by a module-level store, not component state, so code outside the
 * component tree -- the outbox flush, submitWithOutbox -- can read the last
 * known answer with `getReachabilityState().isOnline` instead of guessing.
 * Guessing was the actual bug: a submit made while genuinely offline still
 * tried the live request first and only queued after eating the full 10s
 * axios timeout, which is what made offline counting and checkout feel like
 * they had hung.
 */
type ReachabilityState = {
  status: Reachability;
  isOnline: boolean;
  setStatus: (status: Reachability) => void;
};

const useReachabilityStore = create<ReachabilityState>((set) => ({
  status: 'checking',
  isOnline: false,
  setStatus: (status) => set({ status, isOnline: status === 'online' }),
}));

export const getReachabilityState = () => useReachabilityStore.getState();

/**
 * Reads the shared reachability answer without starting a second poller.
 * `useServerReachability` itself owns the interval/AppState subscription and
 * is mounted once from the root layout; screens that only need to know the
 * current answer (POS settlement falling back to cached reference data,
 * ad-hoc counts choosing whether to bother with a live attempt) should use
 * this instead of mounting the full hook a second time.
 */
export const useIsOnline = () => useReachabilityStore((s) => s.isOnline);

/**
 * Whether the backend is actually reachable.
 *
 * "Has a network connection" is the wrong question here. The server is a box on
 * the shop LAN, so a phone can be happily connected to WiFi -- or to mobile data,
 * which cannot see the LAN at all -- while the API is completely unreachable.
 * Only an actual request answers it, so this probes `/health`, which the API
 * leaves unauthenticated.
 *
 * Polls while the app is foregrounded and re-checks immediately on resume,
 * which is when the answer is most likely to have changed and is also the
 * moment the outbox wants to know.
 */
export function useServerReachability() {
  const serverIp = useSettingsStore((s) => s.serverIp);
  const status = useReachabilityStore((s) => s.status);
  const setStatus = useReachabilityStore((s) => s.setStatus);
  // Held in a ref so the polling effect never needs it as a dependency, which
  // would restart the interval on every state change.
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    if (!serverIp) { setStatus('offline'); return; }

    inFlight.current = true;
    try {
      const state = await Network.getNetworkStateAsync();
      if (!state.isConnected) { setStatus('offline'); return; }

      const base = serverIp.startsWith('http') ? serverIp : `http://${serverIp}`;
      await axios.get(`${base}/api/health`, { timeout: PROBE_TIMEOUT_MS });
      setStatus('online');
    } catch {
      setStatus('offline');
    } finally {
      inFlight.current = false;
    }
  }, [serverIp]);

  useEffect(() => {
    check();
    const timer = setInterval(check, POLL_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [check]);

  return { status, isOnline: status === 'online', recheck: check };
}

export default useServerReachability;
