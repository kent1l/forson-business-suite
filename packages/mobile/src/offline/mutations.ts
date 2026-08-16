/**
 * What may be queued offline, and what "already done" looks like for each.
 *
 * This registry is the safety boundary for the whole outbox. A blanket "retry
 * any failed POST" interceptor would have been far less code, and would also
 * have silently queued goods receipts and stock adjustments -- neither of which
 * can be replayed without double-counting stock. So queueing is opt-in per
 * mutation kind, and each kind must say explicitly how a replay is made safe.
 *
 * `isTerminalError` is the important half. A flush retry that gets a rejection
 * meaning "this already landed" has succeeded, not failed, and the queue must
 * drop the entry rather than retry it forever.
 */

import type { AxiosError, AxiosRequestConfig } from 'axios';

export type OutboxKind = 'cycle-count-submit' | 'cycle-count-edit' | 'time-punch' | 'leave-request';

export type OutboxEntry = {
  id: string;
  kind: OutboxKind;
  /**
   * Who queued this.
   *
   * Every queued write is authorised by whatever token happens to be attached
   * at flush time, and the server derives the employee from that token rather
   * than from the payload -- deliberately, so a punch cannot be filed for
   * someone else. The consequence is that a punch queued by one employee and
   * flushed after a different one logs in on the same shared phone would be
   * recorded against the wrong person. Entries are therefore only ever drained
   * for the user who created them.
   */
  ownerEmployeeId: number | null;
  body: Record<string, unknown>;
  /** Filled in per kind; kept on the entry so the queue needs no kind-specific state. */
  meta?: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string | null;
  status: 'pending' | 'needs-attention';
};

export type MutationDef = {
  /** A short line describing the queued item to the user. */
  describe: (entry: OutboxEntry) => string;
  request: (entry: OutboxEntry) => AxiosRequestConfig;
  /**
   * True when the server's rejection means the write already exists. The entry
   * is then dropped as a success.
   */
  isAlreadyApplied?: (error: AxiosError) => boolean;
  /** Query keys to invalidate once the entry drains. */
  invalidates?: string[][];
};

const status = (error: AxiosError) => error.response?.status;

export const MUTATIONS: Record<OutboxKind, MutationDef> = {
  /**
   * Submitting a cycle count is replay-safe as it stands. The route locks the
   * line `WHERE status = 'PENDING'`, so a second attempt finds nothing to do
   * and 404s -- it fails closed rather than double-counting.
   */
  'cycle-count-submit': {
    describe: (e) => `Count for ${e.meta?.displayName || `line ${e.meta?.lineId}`}`,
    request: (e) => ({
      method: 'POST',
      url: `/inventory/cycle-count/lines/${e.meta?.lineId}/submit`,
      data: e.body,
    }),
    isAlreadyApplied: (err) => status(err) === 404,
    invalidates: [['assignedTasks'], ['myProgress']],
  },

  /** Last-write-wins on a value, so replaying is harmless. */
  'cycle-count-edit': {
    describe: (e) => `Count correction for line ${e.meta?.lineId}`,
    request: (e) => ({
      method: 'PATCH',
      url: `/inventory/cycle-count/lines/${e.meta?.lineId}/edit-count`,
      data: e.body,
    }),
    invalidates: [['myProgress']],
  },

  /**
   * Made replay-safe by `client_punch_id`. The API returns 200 with the
   * original row when a client id it has already seen comes back, so a retry
   * resolves rather than erroring -- and the punch carries `punch_at` from
   * capture time, so a queued clock-in keeps the time it was actually taken.
   */
  'time-punch': {
    describe: (e) => `Clock ${String(e.body.direction).toLowerCase()} at `
      + new Date(String(e.body.punch_at)).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
    request: (e) => ({ method: 'POST', url: '/dtr/punch', data: e.body }),
    isAlreadyApplied: (err) => status(err) === 409,
    invalidates: [['punchState'], ['myDtr']],
  },

  /**
   * No idempotency key, but the overlapping-dates exclusion constraint gives
   * one for free: a replayed request for the same span is rejected with 409,
   * which is precisely "already filed".
   */
  'leave-request': {
    describe: (e) => `Leave request ${e.body.date_from} to ${e.body.date_to}`,
    request: (e) => ({ method: 'POST', url: '/leave/requests', data: e.body }),
    isAlreadyApplied: (err) => status(err) === 409,
    invalidates: [['myLeaveRequests'], ['myLeaveBalances']],
  },
};

/**
 * Whether a failure is worth retrying.
 *
 * A 4xx other than the already-applied cases means the request is malformed or
 * refused and will be refused identically forever, so it goes to
 * needs-attention instead of spinning. 401 is special: the session died, and
 * the whole queue should pause rather than burn attempts on every entry.
 */
export const classifyError = (kind: OutboxKind, error: AxiosError):
  'already-applied' | 'retry' | 'give-up' | 'auth' => {
  const def = MUTATIONS[kind];
  if (def.isAlreadyApplied?.(error)) return 'already-applied';

  const code = status(error);
  if (code === 401) return 'auth';
  if (code === undefined) return 'retry';        // network failure, no response
  if (code >= 500) return 'retry';
  if (code === 408 || code === 429) return 'retry';
  return 'give-up';
};
