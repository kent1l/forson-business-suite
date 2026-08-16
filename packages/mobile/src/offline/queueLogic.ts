/**
 * The queue's decision-making, with no storage or network attached.
 *
 * Kept separate from `outbox.ts` so it can be unit-tested in plain Node: the
 * store itself pulls in AsyncStorage, expo-crypto and SecureStore, none of
 * which exist outside a device. These are the rules that decide whether a
 * clock-in survives a bad afternoon on the shop floor, so they are worth
 * testing directly rather than only through the UI.
 */

import type { OutboxEntry } from './mutations';

export const MAX_ATTEMPTS = 8;

/** Exponential, capped so a long-stuck queue still retries at a sane rate. */
export const backoffMs = (attempts: number) => Math.min(1000 * 2 ** attempts, 60000);

/**
 * Entries eligible for the next drain, oldest first.
 *
 * Scoped to the signed-in employee. Every queued write is authorised by
 * whatever token is attached at flush time, and the server derives the employee
 * from that token rather than the payload -- so a punch queued by one person and
 * flushed after someone else signs in on the same shared phone would be
 * recorded against the wrong employee.
 *
 * Entries belonging to someone else are not dropped; they wait for that person
 * to sign back in, which on a shared warehouse phone is routine.
 */
export const pendingEntries = (entries: OutboxEntry[], currentEmployeeId?: number | null) =>
  entries
    .filter((e) => e.status === 'pending')
    .filter((e) => e.ownerEmployeeId == null || e.ownerEmployeeId === currentEmployeeId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** Applies one failed attempt, parking the entry once it runs out of road. */
export const applyAttempt = (entry: OutboxEntry, error: string): OutboxEntry => {
  const attempts = entry.attempts + 1;
  return {
    ...entry,
    attempts,
    lastError: error,
    status: attempts >= MAX_ATTEMPTS ? 'needs-attention' : entry.status,
  };
};
