import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import axios from 'axios';
import useSettingsStore from '../store/useSettingsStore';

const POLL_MS = 20000;
const PROBE_TIMEOUT_MS = 4000;

export type Reachability = 'checking' | 'online' | 'offline';

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
  const [status, setStatus] = useState<Reachability>('checking');
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
