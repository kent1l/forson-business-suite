import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';

import apiClient from '../../api/client';
import submitWithOutbox from '../../offline/submitWithOutbox';
import useOutboxStore from '../../offline/outbox';
import useAuthStore from '../../store/useAuthStore';
import { scheduleClockOutReminder, cancelClockOutReminder } from '../../utils/clockOutReminder';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/States';
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
 * Clock in and out.
 *
 * The one screen where "did that register?" must never be in doubt: a punch
 * that silently failed surfaces weeks later as a short payslip. So the queued
 * case is shown as prominently as the sent case, and the punch carries the time
 * it was TAKEN rather than the time it eventually syncs.
 */
export default function PunchScreen() {
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const queued = useOutboxStore((s) =>
    s.entries.filter((e) => e.kind === 'time-punch' && e.status === 'pending'),
  );

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ queued: boolean; direction: string; at: string } | null>(null);

  const { data, isLoading, error, refetch } = useQuery<PunchState>({
    queryKey: ['punchState'],
    queryFn: async () => (await apiClient.get('/dtr/punch/state')).data,
  });

  /**
   * What the button should do next.
   *
   * The server's answer describes the state before anything queued, so a punch
   * still sitting in the outbox has to be folded in locally -- otherwise someone
   * who clocked in offline would be offered "Clock In" a second time.
   */
  const lastQueued = queued.length > 0 ? queued[queued.length - 1] : null;
  const nextDirection: 'IN' | 'OUT' = lastQueued
    ? (lastQueued.body.direction === 'IN' ? 'OUT' : 'IN')
    : (data?.next_direction ?? 'IN');

  const punch = useCallback(async () => {
    setBusy(true);
    const capturedAt = new Date().toISOString();
    try {
      const outcome = await submitWithOutbox('time-punch', {
        direction: nextDirection,
        source: 'Mobile',
        // Generated here so a flush retry resolves to the same punch instead of
        // creating a second one.
        client_punch_id: Crypto.randomUUID(),
        punch_at: capturedAt,
      });

      Haptics.notificationAsync(
        outcome.queued
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
      setResult({ queued: outcome.queued, direction: nextDirection, at: capturedAt });

      // A missing clock-out is the most common DTR dispute, since the day is
      // derived from first-IN to last-OUT. Set the reminder on the way in and
      // clear it on the way out.
      if (nextDirection === 'IN') scheduleClockOutReminder();
      else cancelClockOutReminder();

      if (!outcome.queued) refetch();
    } catch (err: any) {
      // Only a refusal reaches here -- a connectivity failure would have been
      // queued instead -- so the server's reason is the useful thing to show.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setResult(null);
      Alert.alert(
        'Punch not recorded',
        err?.response?.data?.message || 'The server rejected that punch. Please tell your supervisor.',
      );
    } finally {
      setBusy(false);
    }
  }, [nextDirection, refetch]);

  const clockingIn = nextDirection === 'IN';

  return (
    <Screen>
      <AppHeader title="Time Clock" subtitle={user ? `${user.first_name} ${user.last_name}` : undefined} />

      <View style={styles.body}>
        {isLoading && !data ? (
          <ActivityIndicator size="large" color={theme.primary} />
        ) : error && !lastQueued ? (
          <ErrorState
            title="Cannot reach the server"
            description="You can still clock in — it will sync when the connection is back."
            onRetry={refetch}
          />
        ) : null}

        <Card style={styles.statusCard}>
          <Text style={[styles.statusLabel, { color: theme.textMuted }]}>Today</Text>
          <Text style={[styles.statusValue, { color: theme.text }]}>
            {lastQueued
              ? `Clocked ${String(lastQueued.body.direction).toLowerCase()} at `
                + timeOf(String(lastQueued.body.punch_at))
              : data?.last_punch_at
                ? `Clocked ${data.last_direction === 'IN' ? 'in' : 'out'} at ${timeOf(data.last_punch_at)}`
                : 'No punches recorded yet'}
          </Text>
          {queued.length > 0 && (
            <View style={[styles.queuedRow, { backgroundColor: theme.warningSoft }]}>
              <Ionicons name="cloud-upload-outline" size={15} color={theme.warning} />
              <Text style={[styles.queuedText, { color: theme.warning }]}>
                {queued.length} punch{queued.length === 1 ? '' : 'es'} saved on this phone, waiting to sync
              </Text>
            </View>
          )}
        </Card>

        <View style={styles.buttonWrap}>
          <Button
            label={busy ? 'Recording…' : clockingIn ? 'Clock In' : 'Clock Out'}
            icon={clockingIn ? 'log-in-outline' : 'log-out-outline'}
            variant={clockingIn ? 'success' : 'primary'}
            size="lg"
            fullWidth
            loading={busy}
            onPress={punch}
          />
        </View>

        {result && result.direction ? (
          <View style={[
            styles.receipt,
            { backgroundColor: result.queued ? theme.warningSoft : theme.successSoft },
          ]}>
            <Ionicons
              name={result.queued ? 'time-outline' : 'checkmark-circle'}
              size={20}
              color={result.queued ? theme.warning : theme.success}
            />
            <Text style={[
              styles.receiptText,
              { color: result.queued ? theme.warning : theme.success },
            ]}>
              {result.queued
                ? `Saved on this phone at ${timeOf(result.at)}. It will be sent automatically — `
                  + 'your recorded time stays as now, not when it syncs.'
                : `Clocked ${result.direction === 'IN' ? 'in' : 'out'} at ${timeOf(result.at)}.`}
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: Spacing.four, gap: Spacing.four },
  statusCard: { gap: Spacing.two },
  statusLabel: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  statusValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  queuedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    padding: Spacing.three, borderRadius: Radius.sm, marginTop: Spacing.two,
  },
  queuedText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  buttonWrap: { marginTop: Spacing.two },
  receipt: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three,
    padding: Spacing.four, borderRadius: Radius.md,
  },
  receiptText: { flex: 1, fontSize: FontSize.base, lineHeight: 20, fontWeight: FontWeight.medium },
});
