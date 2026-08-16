import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import apiClient from '../../api/client';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import StatusBadge, { toneForStatus } from '../../components/ui/StatusBadge';
import { LoadingState, EmptyState, ErrorState } from '../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';

type DtrDay = {
  dtr_id: number;
  work_date: string;
  day_type: string;
  is_rest_day: boolean;
  holiday_name: string | null;
  time_in: string | null;
  time_out: string | null;
  hours_worked: string | null;
  overtime_hours: string | null;
  late_minutes: number | null;
  undertime_minutes: number | null;
};

type Summary = {
  days_paid: string; days_worked: number; days_absent: number;
  days_on_leave: number; hours_worked: string; overtime_hours: string;
};

/** Manila-local YYYY-MM-DD; the API compares against Asia/Manila dates. */
const isoDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);

const monthRange = (offset: number) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: isoDate(start), to: isoDate(end), label: start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }) };
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '—');

/** The employee's own attendance. Read-only: corrections are an HR action. */
export default function TimesheetScreen() {
  const theme = useTheme();
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => monthRange(offset), [offset]);

  const { data: days, isLoading, error, refetch } = useQuery<DtrDay[]>({
    queryKey: ['myDtr', range.from, range.to],
    queryFn: async () => (await apiClient.get(`/dtr/me?from=${range.from}&to=${range.to}`)).data,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['myDtr', 'summary', range.from, range.to],
    queryFn: async () => (await apiClient.get(`/dtr/me/summary?from=${range.from}&to=${range.to}`)).data,
  });

  const renderItem = ({ item }: { item: DtrDay }) => {
    const date = new Date(`${item.work_date}T00:00:00`);
    const label = item.holiday_name || (item.is_rest_day ? 'Rest day' : item.day_type);

    return (
      <Card style={styles.dayCard}>
        <View style={styles.dayLeft}>
          <Text style={[styles.dayNum, { color: theme.text }]}>{date.getDate()}</Text>
          <Text style={[styles.dayName, { color: theme.textMuted }]}>
            {date.toLocaleDateString('en-PH', { weekday: 'short' })}
          </Text>
        </View>

        <View style={styles.dayMid}>
          <StatusBadge label={label} tone={toneForStatus(item.day_type)} />
          <Text style={[styles.times, { color: theme.textSecondary }]}>
            {hhmm(item.time_in)} – {hhmm(item.time_out)}
          </Text>
          {(Number(item.late_minutes) > 0 || Number(item.undertime_minutes) > 0) && (
            <Text style={[styles.exception, { color: theme.warning }]}>
              {Number(item.late_minutes) > 0 ? `${item.late_minutes}m late` : ''}
              {Number(item.late_minutes) > 0 && Number(item.undertime_minutes) > 0 ? ' · ' : ''}
              {Number(item.undertime_minutes) > 0 ? `${item.undertime_minutes}m undertime` : ''}
            </Text>
          )}
        </View>

        <View style={styles.dayRight}>
          <Text style={[styles.hours, { color: theme.text }]}>{Number(item.hours_worked || 0).toFixed(2)}</Text>
          <Text style={[styles.hoursLabel, { color: theme.textMuted }]}>hrs</Text>
          {Number(item.overtime_hours) > 0 && (
            <Text style={[styles.ot, { color: theme.success }]}>+{Number(item.overtime_hours).toFixed(2)} OT</Text>
          )}
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <AppHeader title="My Timesheet" subtitle={range.label} />

      <View style={[styles.monthNav, { borderBottomColor: theme.border }]}>
        <Button label="Previous" icon="chevron-back" variant="ghost" size="sm" onPress={() => setOffset((o) => o - 1)} />
        <Button
          label="This month"
          variant="ghost"
          size="sm"
          disabled={offset === 0}
          onPress={() => setOffset(0)}
        />
        <Button
          label="Next"
          icon="chevron-forward"
          variant="ghost"
          size="sm"
          disabled={offset >= 0}
          onPress={() => setOffset((o) => Math.min(0, o + 1))}
        />
      </View>

      {summary && (
        <View style={[styles.summaryStrip, { backgroundColor: theme.surfaceMuted, borderBottomColor: theme.border }]}>
          {[
            { label: 'Days paid', value: Number(summary.days_paid).toFixed(2) },
            { label: 'Worked', value: String(summary.days_worked) },
            { label: 'Absent', value: String(summary.days_absent) },
            { label: 'Leave', value: String(summary.days_on_leave) },
            { label: 'OT hrs', value: Number(summary.overtime_hours).toFixed(2) },
          ].map((s) => (
            <View key={s.label} style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: theme.text }]}>{s.value}</Text>
              <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {isLoading ? (
        <LoadingState label="Loading your timesheet…" />
      ) : error ? (
        <ErrorState title="Could not load your timesheet" onRetry={refetch} />
      ) : (
        <FlatList
          data={days ?? []}
          keyExtractor={(item) => String(item.dtr_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="Nothing recorded"
              description="No attendance has been generated for this month yet."
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.two, paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryStrip: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: FontSize.md, fontWeight: FontWeight.heavy },
  summaryLabel: { fontSize: FontSize.xs, marginTop: 1 },

  list: { padding: Spacing.four, gap: Spacing.two, flexGrow: 1 },
  dayCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  dayLeft: { width: 40, alignItems: 'center' },
  dayNum: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  dayName: { fontSize: FontSize.xs, textTransform: 'uppercase' },
  dayMid: { flex: 1, gap: Spacing.half },
  times: { fontSize: FontSize.sm },
  exception: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  dayRight: { alignItems: 'flex-end' },
  hours: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  hoursLabel: { fontSize: FontSize.xs },
  ot: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, marginTop: 1 },
});
