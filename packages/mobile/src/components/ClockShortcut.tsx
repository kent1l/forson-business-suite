import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
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

type PunchState = {
  last_direction: 'IN' | 'OUT' | null;
  last_punch_at: string | null;
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
 * The card hides itself once the day is done: after a clock-out it has nothing
 * useful to offer until tomorrow, and leaving a live-looking button there
 * invites an accidental second shift.
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

  if (!canPunch) return null;
  // Nothing to show before the state is known, and nothing useful after the
  // day's clock-out.
  if (!data && !lastQueued) return null;
  if (lastDirection === 'OUT') return null;

  const clockingIn = nextDirection === 'IN';
  const accent = clockingIn ? theme.success : theme.primary;

  return (
    <Card accent={accent} style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: theme.surfaceSunken }]}>
          <Ionicons name={clockingIn ? 'time-outline' : 'walk-outline'} size={22} color={accent} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: theme.text }]}>
            {clockingIn ? 'Start your day' : 'You are clocked in'}
          </Text>
          <Text style={[styles.detail, { color: theme.textMuted }]} numberOfLines={2}>
            {lastAt && !clockingIn
              ? `Since ${timeOf(lastAt)}${lastQueued ? ' · waiting to sync' : ''}`
              : 'Tap to record your time in'}
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
