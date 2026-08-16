/**
 * When the dashboard clock shortcut should be on screen.
 *
 * Kept apart from the component so it can be unit-tested in plain Node — the
 * component imports React Native, which will not load outside a device. The
 * rule has more corners than it looks: unknown schedules, a queued punch the
 * server has not seen yet, and a boundary that must be inclusive so the card is
 * present exactly one hour out.
 */

/** How long before the scheduled end the clock-out offer comes back. */
export const CLOCK_OUT_WINDOW_MINUTES = 60;

/** 'HH:MM:SS' to minutes since midnight, or null if it is not a time. */
export const scheduleMinutes = (hhmmss: string | null | undefined): number | null => {
  if (!hhmmss) return null;
  const [h, m] = String(hhmmss).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

/**
 * Minutes since midnight in Asia/Manila.
 *
 * The phone may be set to another zone and the schedule is expressed in shop
 * local time, so comparing raw device hours would open the window at the wrong
 * moment for a traveller or a mis-set device.
 */
export const manilaMinutesNow = (now: Date = new Date()): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
};

export type ShortcutVisibility = {
  canPunch: boolean;
  /** False until the punch state (or a queued punch) is known. */
  hasState: boolean;
  lastDirection: 'IN' | 'OUT' | null;
  scheduledTimeOut: string | null;
  nowMinutes: number;
};

export const shouldShowShortcut = ({
  canPunch, hasState, lastDirection, scheduledTimeOut, nowMinutes,
}: ShortcutVisibility): boolean => {
  if (!canPunch) return false;
  // Waiting rather than flashing the wrong action for a frame.
  if (!hasState) return false;
  // The day is closed out; anything here would only invite a second shift.
  if (lastDirection === 'OUT') return false;
  // Not clocked in yet, which is the whole point of the card.
  if (lastDirection !== 'IN') return true;

  const endsAt = scheduleMinutes(scheduledTimeOut);
  // Unknown schedule -- no work schedule attached, or a rest day. Stay visible:
  // hiding the quickest way to clock out on the strength of a missing record
  // would cause the forgotten punch this exists to prevent.
  if (endsAt === null) return true;

  // Inclusive, and with no upper bound, so someone running late still has it.
  return nowMinutes >= endsAt - CLOCK_OUT_WINDOW_MINUTES;
};

/** The scheduled finish as a display string, or null when it is not known. */
export const formatScheduledEnd = (scheduledTimeOut: string | null): string | null => {
  const mins = scheduleMinutes(scheduledTimeOut);
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
};
