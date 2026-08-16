import { useEffect, useRef, useCallback } from 'react';
import type { AxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import useAuthStore from '../store/useAuthStore';
import useOutboxStore from './outbox';
import { pendingEntries, backoffMs } from './queueLogic';
import { MUTATIONS, classifyError } from './mutations';

/**
 * Drains the outbox whenever the server becomes reachable.
 *
 * Serial by design. Two entries can target the same cycle-count line -- an edit
 * after a submit -- and flushing in parallel would let the correction land
 * before the thing it corrects. Draining oldest-first in a single chain keeps
 * causality, and the queue is short enough that the lost throughput costs
 * nothing.
 */
export function useOutboxSync(isOnline: boolean) {
  const queryClient = useQueryClient();
  const draining = useRef(false);
  const entries = useOutboxStore((s) => s.entries);
  const isHydrated = useOutboxStore((s) => s.isHydrated);
  const pausedForAuth = useOutboxStore((s) => s.pausedForAuth);

  const drain = useCallback(async () => {
    if (draining.current) return;
    const store = useOutboxStore.getState();
    if (store.pausedForAuth) return;

    draining.current = true;
    try {
      // Re-read from the store each pass rather than closing over `entries`,
      // so anything enqueued mid-drain is picked up by the same run.
      for (;;) {
        const queue = pendingEntries(
          useOutboxStore.getState().entries,
          useAuthStore.getState().user?.employee_id,
        );
        if (queue.length === 0) break;

        const entry = queue[0];
        if (entry.attempts > 0) {
          await new Promise((r) => setTimeout(r, backoffMs(entry.attempts)));
        }

        const def = MUTATIONS[entry.kind];
        let settled = false;

        try {
          await apiClient.request(def.request(entry));
          settled = true;
        } catch (err) {
          const verdict = classifyError(entry.kind, err as AxiosError);

          if (verdict === 'already-applied') {
            // The write is on the server; the only thing that failed was our
            // knowledge of it. Dropping the entry is the correct outcome.
            settled = true;
          } else if (verdict === 'auth') {
            // The session is gone. Stop entirely rather than spending every
            // entry's attempts on the same rejection.
            useOutboxStore.getState().setPausedForAuth(true);
            break;
          } else {
            const message = (err as AxiosError).message || 'Request failed';
            await useOutboxStore.getState().markAttempt(entry.id, message);
            if (verdict === 'give-up') {
              await useOutboxStore.getState().update(entry.id, { status: 'needs-attention' });
            }
            // Whether it retries or was parked, stop this pass: if the server
            // just went away, the rest of the queue will fail the same way.
            break;
          }
        }

        if (settled) {
          await useOutboxStore.getState().remove(entry.id);
          def.invalidates?.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
        }
      }
    } finally {
      draining.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    if (!isHydrated || !isOnline || pausedForAuth) return;
    drain();
  }, [isHydrated, isOnline, pausedForAuth, entries.length, drain]);

  return { drain };
}

export default useOutboxSync;
