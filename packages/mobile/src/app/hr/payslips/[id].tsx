import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';

import apiClient from '../../../api/client';
import downloadAndOpenPdf from '../../../utils/downloadPdf';
import Screen from '../../../components/ui/Screen';
import AppHeader from '../../../components/ui/AppHeader';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import StatusBadge, { toneForStatus } from '../../../components/ui/StatusBadge';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '../../../utils/currency';

type PayslipLine = {
  line_type: string;
  component_code: string | null;
  description: string;
  quantity: string | null;
  rate: string | null;
  amount: string;
};

type PayslipDetail = {
  payslip_id: number;
  payslip_no: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: string;
  days_paid: string;
  gross_pay: string;
  total_deductions: string;
  net_pay: string;
  lines: PayslipLine[];
};

/**
 * Earnings first, then what was taken off -- the order a payslip is read in.
 *
 * EMPLOYER_CONTRIBUTION is kept strictly separate and labelled, because it is
 * the company's share and is NOT taken out of the employee's pay. Folding it in
 * with deductions would read as money they were charged.
 */
const GROUPS: { key: string; title: string; note?: string; types: string[] }[] = [
  { key: 'earnings', title: 'Earnings', types: ['EARNING'] },
  { key: 'deductions', title: 'Deductions', types: ['DEDUCTION'] },
  {
    key: 'employer',
    title: 'Employer Contributions',
    note: 'Paid by the company on your behalf — not deducted from your pay.',
    types: ['EMPLOYER_CONTRIBUTION'],
  },
  { key: 'info', title: 'For Information', types: ['INFO'] },
];

/** Only the first two groups carry a total that matches a payslip header figure. */
const TOTALS: Record<string, { label: string; field: 'gross_pay' | 'total_deductions' }> = {
  earnings: { label: 'Gross Pay', field: 'gross_pay' },
  deductions: { label: 'Total Deductions', field: 'total_deductions' },
};

export default function PayslipDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams() as { id: string };
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<PayslipDetail>({
    queryKey: ['payroll', 'me', 'payslip', id],
    queryFn: async () => (await apiClient.get(`/payroll/me/payslips/${id}`)).data,
    gcTime: 0,
    staleTime: 0,
  });

  const openPdf = async () => {
    setDownloading(true);
    try {
      await downloadAndOpenPdf(
        `/payroll/me/payslips/${id}/pdf`,
        `payslip-${data?.payslip_no || id}.pdf`,
      );
    } catch (err: any) {
      Alert.alert('Could not open payslip', err?.message || 'Please try again when you have a connection.');
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <Screen><AppHeader title="Payslip" /><LoadingState /></Screen>;
  if (error || !data) {
    return (
      <Screen>
        <AppHeader title="Payslip" />
        <ErrorState title="Could not load this payslip" onRetry={refetch} />
      </Screen>
    );
  }

  const grouped = GROUPS.map((g) => ({
    ...g,
    lines: (data.lines || []).filter((l) => g.types.includes(l.line_type)),
  })).filter((g) => g.lines.length > 0);

  // Anything whose line_type did not match a known group still has to appear --
  // a payslip that quietly omits a line is worse than one with an odd heading.
  const known = new Set(GROUPS.flatMap((g) => g.types));
  const other = (data.lines || []).filter((l) => !known.has(l.line_type));

  const Row = ({ line }: { line: PayslipLine }) => (
    <View style={styles.lineRow}>
      <View style={styles.lineLeft}>
        <Text style={[styles.lineDesc, { color: theme.textSecondary }]} numberOfLines={2}>
          {line.description}
        </Text>
        {!!(line.quantity && line.rate) && (
          <Text style={[styles.lineMeta, { color: theme.textMuted }]}>
            {line.quantity} × {formatPHP(line.rate)}
          </Text>
        )}
      </View>
      <Text style={[styles.lineAmount, { color: theme.text }]}>{formatPHP(line.amount)}</Text>
    </View>
  );

  return (
    <Screen>
      <AppHeader title={data.payslip_no || 'Payslip'} subtitle={`${data.period_start} → ${data.period_end}`} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.summary}>
          <View style={styles.rowBetween}>
            <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Net Pay</Text>
            <StatusBadge label={data.status} tone={toneForStatus(data.status)} />
          </View>
          <Text style={[styles.net, { color: theme.text }]}>{formatPHP(data.net_pay)}</Text>
          <Text style={[styles.summaryMeta, { color: theme.textMuted }]}>
            Paid {data.pay_date} · {Number(data.days_paid).toFixed(2)} days
          </Text>
        </Card>

        {grouped.map((group) => {
          const total = TOTALS[group.key];
          return (
            <Card key={group.key} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{group.title}</Text>
              {!!group.note && (
                <Text style={[styles.sectionNote, { color: theme.textMuted }]}>{group.note}</Text>
              )}
              {group.lines.map((line, i) => <Row key={`${group.key}-${i}`} line={line} />)}
              {total && (
                <View style={[styles.totalRow, { borderTopColor: theme.border }]}>
                  <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>{total.label}</Text>
                  <Text style={[styles.totalValue, { color: theme.text }]}>{formatPHP(data[total.field])}</Text>
                </View>
              )}
            </Card>
          );
        })}

        {other.length > 0 && (
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Other</Text>
            {other.map((line, i) => <Row key={`other-${i}`} line={line} />)}
          </Card>
        )}

        <Button
          label="Open PDF"
          icon="document-outline"
          variant="secondary"
          fullWidth
          loading={downloading}
          onPress={openPdf}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  summary: { gap: Spacing.one },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontSize: FontSize.xs, textTransform: 'uppercase', letterSpacing: 1, fontWeight: FontWeight.heavy },
  net: { fontSize: FontSize.xxl, fontWeight: FontWeight.heavy },
  summaryMeta: { fontSize: FontSize.sm },
  section: { gap: Spacing.two },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.one,
  },
  sectionNote: { fontSize: FontSize.sm, marginBottom: Spacing.two, lineHeight: 18 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.three },
  lineLeft: { flex: 1 },
  lineDesc: { fontSize: FontSize.base },
  lineMeta: { fontSize: FontSize.xs, marginTop: 1 },
  lineAmount: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, marginTop: Spacing.two,
  },
  totalLabel: { fontSize: FontSize.base, fontWeight: FontWeight.bold },
  totalValue: { fontSize: FontSize.base, fontWeight: FontWeight.heavy },
});
