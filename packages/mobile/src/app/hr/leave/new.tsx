import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import apiClient from '../../../api/client';
import submitWithOutbox from '../../../offline/submitWithOutbox';
import Screen from '../../../components/ui/Screen';
import AppHeader from '../../../components/ui/AppHeader';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import { LoadingState } from '../../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

type LeaveType = { leave_type_id: number; leave_code: string; leave_name: string; is_paid: boolean };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Files a leave request for the signed-in employee.
 *
 * No employee picker: the server ignores any employee_id from a caller without
 * `leave:manage` and files for the token holder, so offering one would be
 * misleading. Total days are deliberately not computed here either -- rest days
 * and holidays inside the span are not charged, and only the server knows the
 * employee's schedule.
 */
export default function NewLeaveScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [typeId, setTypeId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: types, isLoading } = useQuery<LeaveType[]>({
    queryKey: ['leaveTypes'],
    queryFn: async () => (await apiClient.get('/leave/types')).data,
  });

  const submit = async () => {
    if (!typeId) return Alert.alert('Pick a leave type', 'Choose which kind of leave you are requesting.');
    if (!ISO.test(dateFrom) || !ISO.test(dateTo)) {
      return Alert.alert('Check the dates', 'Enter both dates as YYYY-MM-DD, for example 2026-09-01.');
    }
    if (dateTo < dateFrom) {
      return Alert.alert('Check the dates', 'The end date cannot be before the start date.');
    }

    setSaving(true);
    try {
      const outcome = await submitWithOutbox('leave-request', {
        leave_type_id: typeId,
        date_from: dateFrom,
        date_to: dateTo,
        day_fraction: halfDay ? 0.5 : 1,
        reason: reason.trim() || null,
      });

      queryClient.invalidateQueries({ queryKey: ['myLeaveRequests'] });
      queryClient.invalidateQueries({ queryKey: ['myLeaveBalances'] });

      Alert.alert(
        outcome.queued ? 'Saved on this phone' : 'Request filed',
        outcome.queued
          ? 'It will be sent to your manager when the server is reachable.'
          : 'Your manager will see it for approval.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Could not file that request', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Screen><AppHeader title="Request Leave" /><LoadingState /></Screen>;

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text },
  ];

  return (
    <Screen>
      <AppHeader title="Request Leave" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Card style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Leave type</Text>
          <View style={styles.typeGrid}>
            {(types ?? []).map((t) => {
              const selected = t.leave_type_id === typeId;
              return (
                <TouchableOpacity
                  key={t.leave_type_id}
                  onPress={() => setTypeId(t.leave_type_id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: selected ? theme.primarySoft : theme.surfaceMuted,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.typeCode, { color: selected ? theme.primary : theme.text }]}>
                    {t.leave_code}
                  </Text>
                  <Text style={[styles.typeName, { color: theme.textMuted }]} numberOfLines={1}>
                    {t.leave_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>From</Text>
          <TextInput
            style={inputStyle}
            value={dateFrom}
            onChangeText={setDateFrom}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textMuted}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>To</Text>
          <TextInput
            style={inputStyle}
            value={dateTo}
            onChangeText={setDateTo}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textMuted}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />

          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setHalfDay((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: halfDay }}
          >
            <View style={[
              styles.checkbox,
              { borderColor: halfDay ? theme.primary : theme.borderStrong, backgroundColor: halfDay ? theme.primary : 'transparent' },
            ]} />
            <Text style={[styles.checkLabel, { color: theme.textSecondary }]}>Half day</Text>
          </TouchableOpacity>

          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Rest days and holidays inside these dates are not counted against your balance.
          </Text>
        </Card>

        <Card style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Reason (optional)</Text>
          <TextInput
            style={[...inputStyle, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            placeholder="Anything your manager should know"
            placeholderTextColor={theme.textMuted}
            multiline
          />
        </Card>

        <Button label="Submit request" icon="send" fullWidth loading={saving} onPress={submit} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  section: { gap: Spacing.two },
  label: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: FontSize.base,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  typeChip: {
    borderWidth: 1, borderRadius: Radius.md,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
    minWidth: '47%', flexGrow: 1,
  },
  typeCode: { fontSize: FontSize.base, fontWeight: FontWeight.heavy },
  typeName: { fontSize: FontSize.xs, marginTop: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  checkbox: { width: 20, height: 20, borderRadius: Radius.sm, borderWidth: 2 },
  checkLabel: { fontSize: FontSize.base, fontWeight: FontWeight.medium },
  hint: { fontSize: FontSize.sm, lineHeight: 18, marginTop: Spacing.one },
});
