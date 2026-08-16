import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';

import apiClient from '../api/client';
import submitWithOutbox from '../offline/submitWithOutbox';
import useOutboxStore from '../offline/outbox';
import { usePermission } from '../hooks/usePermission';
import { scheduleClockOutReminder, cancelClockOutReminder } from '../utils/clockOutReminder';
import Card from './ui/Card';
import Button from './ui/Button';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import {
  shouldShowShortcut,
  manilaMinutesNow,
  formatScheduledEnd,
} from './clockShortcutRules';

/** Re-evaluated on a timer so the card appears without needing a reload. */
const VISIBILITY_TICK_MS = 60 * 1000;

type PunchState = {
  last_direction: 'IN' | 'OUT' | null;
  last_punch_at: string | null;
  /** 'HH:MM:SS' in Asia/Manila, or null when today's end is unknown. */
  scheduled_time_out: string | null;
  next_direction: 'IN' | 'OUT';
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

/**
 * One-tap clock in and out, on the dashboard.
 *
 * Clocking in is the first thing anyone does and clocking out is the last, and
 * both were two navigations deep. Surfacing them where the app opens is the
 * difference between a punch that happens and one that gets forgotten —
 * forgotten punches are the most common DTR dispute.
 *
 * It is shown sparingly, because a shortcut that is always present stops being
 * read. It appears before the first clock-in, steps aside for the working day,
 * and returns an hour before the scheduled end so the clock-out is one tap away
 * when it matters. After the clock-out it disappears until tomorrow -- a
 * live-looking button there only invites an accidental second shift.
 */
export default function ClockShortcut() {
  const theme = useTheme();
  const router = useRouter();
  const { hasPermission } = usePermission();
  const canPunch = hasPermission('dtr:punch');

  /**
   * Filtered outside the selector, not inside it.
   *
   * Zustand v5 reads through useSyncExternalStore, which compares the snapshot
   * by reference and re-renders when it changes. A selector ending in `.filter`
   * builds a fresh array on every call, so the snapshot never compares equal and
   * the component re-renders forever — React eventually gives up with "Maximum
   * update depth exceeded". Selecting the stored array keeps the reference
   * stable and moves the derivation into a memo.
   */
  const entries = useOutboxStore((s) => s.entries);
  const queuedPunches = React.useMemo(
    () => entries.filter((e) => e.kind === 'time-punch' && e.status === 'pending'),
    [entries],
  );

  const [busy, setBusy] = useState(false);

  /**
   * Re-read the wall clock on a timer, and again whenever the app is brought
   * forward.
   *
   * Without this the card would only reappear when something else happened to
   * re-render the dashboard, so someone who left the app open through the
   * afternoon would never be offered the clock-out.
   */
  const [nowMinutes, setNowMinutes] = useState(manilaMinutesNow);
  useEffect(() => {
    const tick = () => setNowMinutes(manilaMinutesNow());
    const timer = setInterval(tick, VISIBILITY_TICK_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, []);

  const { data, refetch } = useQuery<PunchState>({
    queryKey: ['punchState'],
    queryFn: async () => (await apiClient.get('/dtr/punch/state')).data,
    enabled: canPunch,
  });

  /**
   * The server's answer predates anything still queued, so a punch waiting in
   * the outbox has to be folded in — otherwise someone who clocked in offline
   * is offered "Clock In" again and ends up with two.
   */
  const lastQueued = queuedPunches.length > 0 ? queuedPunches[queuedPunches.length - 1] : null;
  const lastDirection: 'IN' | 'OUT' | null = lastQueued
    ? (lastQueued.body.direction as 'IN' | 'OUT')
    : (data?.last_direction ?? null);
  const lastAt = lastQueued ? String(lastQueued.body.punch_at) : data?.last_punch_at ?? null;
  const nextDirection: 'IN' | 'OUT' = lastDirection === 'IN' ? 'OUT' : 'IN';

  const punch = useCallback(async () => {
    setBusy(true);
    const capturedAt = new Date().toISOString();
    try {
      const outcome = await submitWithOutbox('time-punch', {
        direction: nextDirection,
        source: 'Mobile',
        client_punch_id: Crypto.randomUUID(),
        punch_at: capturedAt,
      });

      Haptics.notificationAsync(
        outcome.queued
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );

      if (nextDirection === 'IN') scheduleClockOutReminder();
      else cancelClockOutReminder();

      Alert.alert(
        nextDirection === 'IN' ? 'Clocked in' : 'Clocked out',
        outcome.queued
          ? `Saved on this phone at ${timeOf(capturedAt)}. It will sync automatically, and your `
            + 'recorded time stays as now.'
          : `Recorded at ${timeOf(capturedAt)}.`,
      );

      if (!outcome.queued) refetch();
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Punch not recorded',
        err?.response?.data?.message || 'The server rejected that punch. Please tell your supervisor.',
      );
    } finally {
      setBusy(false);
    }
  }, [nextDirection, refetch]);

  if (!shouldShowShortcut({
    canPunch,
    hasState: Boolean(data || lastQueued),
    lastDirection,
    scheduledTimeOut: data?.scheduled_time_out ?? null,
    nowMinutes,
  })) return null;

  const clockingIn = nextDirection === 'IN';
  const accent = clockingIn ? theme.success : theme.primary;
  // Shown only when the schedule is actually known, so the card never implies
  // an end time it is guessing at.
  const endsAtLabel = formatScheduledEnd(data?.scheduled_time_out ?? null);

  return (
    <Card accent={accent} style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: theme.surfaceSunken }]}>
          <Ionicons name={clockingIn ? 'time-outline' : 'walk-outline'} size={22} color={accent} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: theme.text }]}>
            {clockingIn ? 'Start your day' : 'Wrapping up?'}
          </Text>
          <Text style={[styles.detail, { color: theme.textMuted }]} numberOfLines={2}>
            {clockingIn
              ? 'Tap to record your time in'
              : [
                  lastAt ? `Clocked in at ${timeOf(lastAt)}` : 'You are clocked in',
                  endsAtLabel ? `shift ends ${endsAtLabel}` : null,
                  lastQueued ? 'waiting to sync' : null,
                ].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label={busy ? 'Recording…' : clockingIn ? 'Clock In' : 'Clock Out'}
          icon={clockingIn ? 'log-in-outline' : 'log-out-outline'}
          variant={clockingIn ? 'success' : 'primary'}
          loading={busy}
          onPress={punch}
          style={styles.primaryAction}
        />
        <Button
          label="Details"
          variant="secondary"
          onPress={() => router.push('/hr/punch')}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  detail: { fontSize: FontSize.sm, marginTop: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  primaryAction: { flex: 1 },
});
