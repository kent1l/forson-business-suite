import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import apiClient from '../../../api/client';
import RequirePermission from '../../../components/RequirePermission';
import Screen from '../../../components/ui/Screen';
import AppHeader from '../../../components/ui/AppHeader';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { LoadingState, EmptyState, ErrorState } from '../../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';

type PendingRequest = {
  leave_id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  leave_name: string;
  date_from: string;
  date_to: string;
  total_days: string;
  reason: string | null;
};

/**
 * The one screen here that reads other people's records, so it is gated on
 * `leave:approve` rather than the self-service keys. Self-approval is already
 * refused server-side.
 *
 * Decisions are never queued offline: an approval writes DTR days, and a
 * manager needs to know it actually took effect.
 */
function ApprovalsInner() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [actingOn, setActingOn] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery<PendingRequest[]>({
    queryKey: ['leaveApprovals'],
    queryFn: async () => (await apiClient.get('/leave/requests?status=Pending')).data,
  });

  const decide = async (item: PendingRequest, action: 'approve' | 'reject') => {
    setActingOn(item.leave_id);
    try {
      await apiClient.post(`/leave/requests/${item.leave_id}/${action}`, {});
      queryClient.invalidateQueries({ queryKey: ['leaveApprovals'] });
    } catch (err: any) {
      Alert.alert(
        action === 'approve' ? 'Could not approve' : 'Could not reject',
        err?.response?.data?.message || 'Please try again.',
      );
    } finally {
      setActingOn(null);
    }
  };

  const confirmReject = (item: PendingRequest) => {
    Alert.alert('Reject this request?', `${item.employee_name} — ${item.leave_name}`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => decide(item, 'reject') },
    ]);
  };

  const renderItem = ({ item }: { item: PendingRequest }) => (
    <Card style={styles.card}>
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
        {item.employee_name}
        {item.employee_code ? ` · ${item.employee_code}` : ''}
      </Text>
      <Text style={[styles.detail, { color: theme.textSecondary }]}>
        {item.leave_name} · {Number(item.total_days).toFixed(2)} day
        {Number(item.total_days) === 1 ? '' : 's'}
      </Text>
      <Text style={[styles.detail, { color: theme.textMuted }]}>
        {item.date_from} → {item.date_to}
      </Text>
      {!!item.reason && (
        <Text style={[styles.reason, { color: theme.textMuted }]} numberOfLines={4}>{item.reason}</Text>
      )}

      <View style={styles.actions}>
        <Button
          label="Approve"
          variant="success"
          size="sm"
          icon="checkmark"
          loading={actingOn === item.leave_id}
          onPress={() => decide(item, 'approve')}
          style={styles.actionBtn}
        />
        <Button
          label="Reject"
          variant="secondary"
          size="sm"
          icon="close"
          disabled={actingOn === item.leave_id}
          onPress={() => confirmReject(item)}
          style={styles.actionBtn}
        />
      </View>
    </Card>
  );

  return (
    <Screen>
      <AppHeader title="Leave Approvals" subtitle={data ? `${data.length} pending` : undefined} />
      {isLoading ? (
        <LoadingState label="Loading pending requests…" />
      ) : error ? (
        <ErrorState title="Could not load requests" onRetry={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.leave_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-outline"
              title="Nothing waiting"
              description="There are no leave requests pending approval."
            />
          }
        />
      )}
    </Screen>
  );
}

export default function ApprovalsScreen() {
  return (
    <RequirePermission permission="leave:approve" title="Leave Approvals">
      <ApprovalsInner />
    </RequirePermission>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  card: { gap: Spacing.half },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  detail: { fontSize: FontSize.sm },
  reason: { fontSize: FontSize.sm, lineHeight: 18, marginTop: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  actionBtn: { flex: 1 },
});
