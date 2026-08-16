import React from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import apiClient from '../../../api/client';
import { usePermission } from '../../../hooks/usePermission';
import Screen from '../../../components/ui/Screen';
import AppHeader from '../../../components/ui/AppHeader';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import StatusBadge, { toneForStatus } from '../../../components/ui/StatusBadge';
import { LoadingState, EmptyState, ErrorState } from '../../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';

type Balance = {
  leave_type_id: number;
  leave_code: string;
  leave_name: string;
  entitled_days: string;
  carried_over_days: string;
  used_days: string;
  remaining_days: string;
};

type LeaveRequest = {
  leave_id: number;
  leave_code: string;
  leave_name: string;
  date_from: string;
  date_to: string;
  total_days: string;
  status: string;
  reason: string | null;
  decision_note: string | null;
};

export default function LeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();

  const balances = useQuery<{ balances: Balance[] }>({
    queryKey: ['myLeaveBalances'],
    queryFn: async () => (await apiClient.get('/leave/me/balances')).data,
    // Not persisted to disk: entitlement is personal data on a shared phone.
    gcTime: 0,
  });

  const requests = useQuery<LeaveRequest[]>({
    queryKey: ['myLeaveRequests'],
    queryFn: async () => (await apiClient.get('/leave/me/requests')).data,
  });

  const cancel = (item: LeaveRequest) => {
    Alert.alert(
      'Cancel this request?',
      `${item.leave_name}, ${item.date_from} to ${item.date_to}.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post(`/leave/requests/${item.leave_id}/cancel`, {});
              queryClient.invalidateQueries({ queryKey: ['myLeaveRequests'] });
              queryClient.invalidateQueries({ queryKey: ['myLeaveBalances'] });
            } catch (err: any) {
              Alert.alert('Could not cancel', err?.response?.data?.message || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const renderRequest = ({ item }: { item: LeaveRequest }) => (
    <Card style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={[styles.leaveName, { color: theme.text }]} numberOfLines={1}>{item.leave_name}</Text>
        <StatusBadge label={item.status} tone={toneForStatus(item.status)} />
      </View>
      <Text style={[styles.dates, { color: theme.textSecondary }]}>
        {item.date_from} → {item.date_to} · {Number(item.total_days).toFixed(2)} day
        {Number(item.total_days) === 1 ? '' : 's'}
      </Text>
      {!!item.reason && (
        <Text style={[styles.reason, { color: theme.textMuted }]} numberOfLines={3}>{item.reason}</Text>
      )}
      {!!item.decision_note && (
        <Text style={[styles.reason, { color: theme.textMuted }]} numberOfLines={3}>
          Note: {item.decision_note}
        </Text>
      )}
      {item.status === 'Pending' && (
        <Button label="Cancel" variant="secondary" size="sm" onPress={() => cancel(item)} style={styles.cancelBtn} />
      )}
    </Card>
  );

  const header = () => (
    <View style={styles.header}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Your Balances</Text>
      {balances.isLoading ? (
        <LoadingState label="Loading balances…" />
      ) : balances.error ? (
        <ErrorState title="Could not load balances" onRetry={balances.refetch} />
      ) : (
        <View style={styles.balanceGrid}>
          {(balances.data?.balances ?? []).map((b) => (
            <Card key={b.leave_type_id} style={styles.balanceCard}>
              <Text style={[styles.balanceValue, { color: theme.text }]}>
                {Number(b.remaining_days).toFixed(2)}
              </Text>
              <Text style={[styles.balanceCode, { color: theme.textSecondary }]}>{b.leave_code}</Text>
              <Text style={[styles.balanceName, { color: theme.textMuted }]} numberOfLines={2}>
                {b.leave_name}
              </Text>
              <Text style={[styles.balanceMeta, { color: theme.textMuted }]}>
                {Number(b.used_days).toFixed(2)} used
              </Text>
            </Card>
          ))}
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Your Requests</Text>
    </View>
  );

  return (
    <Screen>
      <AppHeader
        title="Leave"
        right={
          hasPermission('leave:approve')
            ? <Button label="Approvals" variant="ghost" size="sm" onPress={() => router.push('/hr/leave/approvals')} />
            : undefined
        }
      />

      {requests.isLoading ? (
        <LoadingState label="Loading your leave…" />
      ) : (
        <FlatList
          data={requests.data ?? []}
          keyExtractor={(item) => String(item.leave_id)}
          renderItem={renderRequest}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            requests.error ? (
              <ErrorState title="Could not load your requests" onRetry={requests.refetch} />
            ) : (
              <EmptyState
                icon="calendar-clear-outline"
                title="No leave requests"
                description="Requests you file appear here with their approval status."
              />
            )
          }
        />
      )}

      {hasPermission('leave:request') && (
        <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
          <Button label="Request Leave" icon="add" fullWidth onPress={() => router.push('/hr/leave/new')} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  header: { gap: Spacing.two },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: Spacing.two,
  },
  balanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginBottom: Spacing.two },
  balanceCard: { width: '48%', flexGrow: 1 },
  balanceValue: { fontSize: FontSize.xl, fontWeight: FontWeight.heavy },
  balanceCode: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  balanceName: { fontSize: FontSize.xs, marginTop: 1 },
  balanceMeta: { fontSize: FontSize.xs, marginTop: Spacing.one },

  card: { gap: Spacing.one },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  leaveName: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.bold },
  dates: { fontSize: FontSize.sm },
  reason: { fontSize: FontSize.sm, lineHeight: 18 },
  cancelBtn: { alignSelf: 'flex-start', marginTop: Spacing.two },

  footer: { padding: Spacing.four, borderTopWidth: StyleSheet.hairlineWidth },
});
