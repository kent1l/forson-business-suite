import * as Notifications from 'expo-notifications';

/**
 * A local reminder to clock out.
 *
 * Forgetting to clock out is the single most common DTR dispute: the day is
 * derived from first-IN to last-OUT, so a missing OUT leaves an incomplete day
 * that HR has to reconstruct from memory. A reminder scheduled on the device
 * when someone clocks in costs nothing and prevents most of them.
 *
 * Deliberately local rather than push. It needs no server, no device-token
 * registry and no delivery infrastructure, and it works on the shop LAN with no
 * internet at all -- which is the environment these phones actually live in.
 */

const REMINDER_ID_KEY = 'clock-out-reminder';
const DEFAULT_SHIFT_HOURS = 9;

/** Asks once; a refusal is remembered by the OS and must not be nagged. */
export async function ensureNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  if (existing === 'denied') return false;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedules the reminder for `hours` after a clock-in, replacing any previous
 * one so a re-punch does not stack up duplicates.
 */
export async function scheduleClockOutReminder(hours: number = DEFAULT_SHIFT_HOURS): Promise<void> {
  try {
    if (!(await ensureNotificationPermission())) return;
    await cancelClockOutReminder();

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID_KEY,
      content: {
        title: 'Still clocked in',
        body: 'Remember to clock out before you leave, so your hours are recorded correctly.',
        data: { route: '/hr/punch' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(hours * 3600),
      },
    });
  } catch (err) {
    // A reminder is a convenience; never let it break the punch itself.
    console.warn('Could not schedule clock-out reminder', err);
  }
}

export async function cancelClockOutReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID_KEY);
  } catch {
    // Nothing scheduled, which is the state we wanted anyway.
  }
}
