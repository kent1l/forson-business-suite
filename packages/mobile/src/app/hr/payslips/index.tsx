import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import apiClient from '../../../api/client';
import Screen from '../../../components/ui/Screen';
import AppHeader from '../../../components/ui/AppHeader';
import Card from '../../../components/ui/Card';
import StatusBadge, { toneForStatus } from '../../../components/ui/StatusBadge';
import { LoadingState, EmptyState, ErrorState } from '../../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '../../../utils/currency';

type Payslip = {
  payslip_id: number;
  payslip_no: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  gross_pay: string;
  total_deductions: string;
  net_pay: string;
  status: string;
};

/**
 * The employee's own payslips.
 *
 * Never cached to disk -- see the persistence allowlist in _layout.tsx. These
 * are sideloaded, sometimes shared phones, so pay figures live in memory for
 * the session and no longer.
 */
export default function PayslipsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery<Payslip[]>({
    queryKey: ['payroll', 'me', 'payslips'],
    queryFn: async () => (await apiClient.get('/payroll/me/payslips')).data,
    gcTime: 0,
    staleTime: 0,
  });

  const renderItem = ({ item }: { item: Payslip }) => (
    <Card onPress={() => router.push(`/hr/payslips/${item.payslip_id}` as never)} style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={[styles.period, { color: theme.text }]}>
          {item.period_start} → {item.period_end}
        </Text>
        <StatusBadge label={item.status} tone={toneForStatus(item.status)} />
      </View>

      <Text style={[styles.payDate, { color: theme.textMuted }]}>Paid {item.pay_date}</Text>

      <View style={[styles.amounts, { borderTopColor: theme.border }]}>
        <View>
          <Text style={[styles.amountLabel, { color: theme.textMuted }]}>Gross</Text>
          <Text style={[styles.amountValue, { color: theme.textSecondary }]}>{formatPHP(item.gross_pay)}</Text>
        </View>
        <View>
          <Text style={[styles.amountLabel, { color: theme.textMuted }]}>Deductions</Text>
          <Text style={[styles.amountValue, { color: theme.textSecondary }]}>{formatPHP(item.total_deductions)}</Text>
        </View>
        <View style={styles.netCol}>
          <Text style={[styles.amountLabel, { color: theme.textMuted }]}>Net Pay</Text>
          <Text style={[styles.netValue, { color: theme.text }]}>{formatPHP(item.net_pay)}</Text>
        </View>
      </View>
    </Card>
  );

  return (
    <Screen>
      <AppHeader title="My Pay" />
      {isLoading ? (
        <LoadingState label="Loading your payslips…" />
      ) : error ? (
        <ErrorState
          title="Could not load your payslips"
          description="Payslips need a connection to the server."
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.payslip_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No payslips yet"
              description="Your payslips appear here once a payroll run covering you is approved."
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  card: { gap: Spacing.one },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  period: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.bold },
  payDate: { fontSize: FontSize.sm },
  amounts: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: Spacing.three, paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  netCol: { alignItems: 'flex-end' },
  amountLabel: { fontSize: FontSize.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  amountValue: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, marginTop: 1 },
  netValue: { fontSize: FontSize.md, fontWeight: FontWeight.heavy, marginTop: 1 },
});
