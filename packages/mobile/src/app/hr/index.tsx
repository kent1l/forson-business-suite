import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../../api/client';
import useAuthStore from '../../store/useAuthStore';
import useOutboxStore from '../../offline/outbox';
import { usePermission } from '../../hooks/usePermission';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

type PunchState = { last_direction: 'IN' | 'OUT' | null; last_punch_at: string | null; next_direction: 'IN' | 'OUT' };

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

/**
 * Employee self-service hub.
 *
 * Each card is gated on its own permission, so a user who holds only some of
 * them sees a shorter list rather than a broken screen. In practice all three
 * self-service keys are granted to every role, but that is a seeding decision
 * an admin can change.
 */
export default function HrHomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { hasPermission, hasAny } = usePermission();
  const queuedPunches = useOutboxStore(
    (s) => s.entries.filter((e) => e.kind === 'time-punch' && e.status === 'pending').length,
  );

  const canPunch = hasPermission('dtr:punch');

  const { data: punchState } = useQuery<PunchState>({
    queryKey: ['punchState'],
    queryFn: async () => (await apiClient.get('/dtr/punch/state')).data,
    enabled: canPunch,
  });

  const cards = [
    {
      key: 'punch',
      show: canPunch,
      title: 'Time Clock',
      icon: 'time-outline' as const,
      accent: theme.success,
      route: '/hr/punch',
      detail: queuedPunches > 0
        ? `${queuedPunches} punch${queuedPunches === 1 ? '' : 'es'} waiting to sync`
        : punchState?.last_punch_at
          ? `Last ${punchState.last_direction === 'IN' ? 'in' : 'out'} at ${timeOf(punchState.last_punch_at)}`
          : 'No punches today',
      cta: punchState?.next_direction === 'OUT' ? 'Clock out' : 'Clock in',
    },
    {
      key: 'timesheet',
      show: hasAny(['dtr:view_own', 'dtr:view']),
      title: 'My Timesheet',
      icon: 'calendar-outline' as const,
      accent: theme.primary,
      route: '/hr/timesheet',
      detail: 'Your attendance this month',
    },
    {
      key: 'payslips',
      show: hasPermission('payslip:view_own'),
      title: 'My Pay',
      icon: 'cash-outline' as const,
      accent: theme.info,
      route: '/hr/payslips',
      detail: 'Payslips and breakdowns',
    },
    {
      key: 'leave',
      show: hasAny(['leave:request', 'leave:view_own', 'leave:view']),
      title: 'Leave',
      icon: 'airplane-outline' as const,
      accent: theme.warning,
      route: '/hr/leave',
      detail: 'Balances and requests',
    },
    {
      key: 'approvals',
      show: hasPermission('leave:approve'),
      title: 'Leave Approvals',
      icon: 'checkmark-done-outline' as const,
      accent: theme.danger,
      route: '/hr/leave/approvals',
      detail: 'Requests waiting on you',
    },
  ].filter((c) => c.show);

  return (
    <Screen>
      <AppHeader
        title="My HR"
        subtitle={user ? `${user.first_name} ${user.last_name}` : undefined}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {cards.map((card) => (
          <Card key={card.key} accent={card.accent} onPress={() => router.push(card.route as never)}>
            <View style={styles.row}>
              <View style={[styles.iconBox, { backgroundColor: theme.surfaceSunken }]}>
                <Ionicons name={card.icon} size={22} color={card.accent} />
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.title, { color: theme.text }]}>{card.title}</Text>
                <Text style={[styles.detail, { color: theme.textMuted }]} numberOfLines={2}>
                  {card.detail}
                </Text>
              </View>
              {card.cta ? (
                <View style={[styles.cta, { backgroundColor: card.accent }]}>
                  <Text style={styles.ctaText}>{card.cta}</Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
              )}
            </View>
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.four, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  iconBox: { width: 42, height: 42, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  detail: { fontSize: FontSize.sm, marginTop: 1 },
  cta: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.pill },
  ctaText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.heavy, textTransform: 'uppercase' },
});
