import type { AxiosError } from 'axios';
import apiClient from '../api/client';
import useOutboxStore from './outbox';
import { getReachabilityState } from '../hooks/useServerReachability';
import { MUTATIONS, classifyError, type OutboxKind } from './mutations';

export type SubmitOutcome =
  | { queued: false; data: unknown }
  | { queued: true; reason: 'offline' };

/**
 * Sends a mutation now, or queues it if the server cannot be reached.
 *
 * Online-first rather than queue-always: when the LAN is up -- which is most of
 * the time -- the user should get the real result immediately, including
 * validation errors the server alone can produce. The queue is the fallback,
 * not the default path.
 *
 * Only a genuine connectivity failure is queued. A 4xx means the server heard
 * us and said no, and retrying that later would just fail again at a point
 * where nobody is watching, so those are rethrown for the caller to surface.
 *
 * When useServerReachability already knows the server is unreachable, the
 * live attempt is skipped entirely rather than made and awaited to failure.
 * Without this, every count or sale rung up during a blackout paid the full
 * 10s axios timeout before falling back to the queue -- correct, but slow
 * enough that offline work felt broken rather than merely deferred. The
 * reachability poll can be up to ~20s stale, so a wrong "offline" here just
 * means an item that could have gone straight through gets queued instead
 * and drains on the next flush -- never a lost write.
 */
export async function submitWithOutbox(
  kind: OutboxKind,
  body: Record<string, unknown>,
  meta?: Record<string, unknown>,
): Promise<SubmitOutcome> {
  const entry = {
    id: 'probe', kind, ownerEmployeeId: null, body, meta,
    createdAt: new Date().toISOString(), attempts: 0, status: 'pending' as const,
  };

  if (!getReachabilityState().isOnline) {
    await useOutboxStore.getState().enqueue(kind, body, meta);
    return { queued: true, reason: 'offline' };
  }

  try {
    const { data } = await apiClient.request(MUTATIONS[kind].request(entry));
    return { queued: false, data };
  } catch (err) {
    const verdict = classifyError(kind, err as AxiosError);

    // Already on the server; nothing to queue and nothing to report as an error.
    if (verdict === 'already-applied') return { queued: false, data: null };

    if (verdict === 'retry') {
      await useOutboxStore.getState().enqueue(kind, body, meta);
      return { queued: true, reason: 'offline' };
    }

    throw err;
  }
}

export default submitWithOutbox;
