import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../../api/client';
import { usePermission } from '../../hooks/usePermission';
import useServerReachability from '../../hooks/useServerReachability';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { LoadingState, EmptyState, ErrorState } from '../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '../../utils/currency';

type Movement = {
  inv_trans_id: string;
  transaction_date: string;
  trans_type: string;
  quantity: string;
  unit_cost: string;
  reference_no: string | null;
  notes: string | null;
  first_name: string | null;
  last_name: string | null;
};

type PartDetail = {
  part_id: number;
  internal_sku: string;
  display_name: string;
  stock_on_hand: string;
  last_sale_price: string | null;
  wac_cost: string | null;
  barcodes: string[] | null;
};

export default function PartDetailScreen() {
  const theme = useTheme();
  const { partId } = useLocalSearchParams() as { partId: string };
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { isOnline } = useServerReachability();

  const [adjusting, setAdjusting] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);

  const canAdjust = hasPermission('inventory:adjust');
  const canSeeHistory = hasPermission('inventory:view');

  const part = useQuery<PartDetail | null>({
    queryKey: ['partDetail', partId],
    queryFn: async () => {
      // Power search is the only endpoint that returns stock alongside the
      // catalogue fields, and it takes a keyword rather than an id -- so search
      // by SKU and pick the exact match.
      const { data } = await apiClient.get(`/parts/${partId}`);
      const sku = data?.internal_sku;
      if (!sku) return data;
      const { data: hits } = await apiClient.get(`/power-search/parts?keyword=${encodeURIComponent(sku)}`);
      const match = (Array.isArray(hits) ? hits : []).find((h: any) => String(h.part_id) === String(partId));
      return match ? { ...data, ...match } : data;
    },
  });

  const history = useQuery<Movement[]>({
    queryKey: ['partHistory', partId],
    queryFn: async () => (await apiClient.get(`/inventory/${partId}/history`)).data,
    enabled: canSeeHistory,
  });

  const submitAdjustment = async () => {
    const qty = parseFloat(adjustQty);
    if (!Number.isFinite(qty) || qty === 0) {
      return Alert.alert('Enter a quantity', 'Use a positive number to add stock, or a negative one to remove it.');
    }
    if (!adjustNote.trim()) {
      return Alert.alert('Add a reason', 'An adjustment without a reason cannot be reviewed later.');
    }

    setSaving(true);
    try {
      await apiClient.post('/inventory/adjust', {
        part_id: Number(partId),
        quantity: qty,
        notes: adjustNote.trim(),
      });
      setAdjusting(false);
      setAdjustQty('');
      setAdjustNote('');
      queryClient.invalidateQueries({ queryKey: ['partDetail', partId] });
      queryClient.invalidateQueries({ queryKey: ['partHistory', partId] });
      Alert.alert('Stock adjusted', 'The change has been recorded.');
    } catch (err: any) {
      Alert.alert('Could not adjust stock', err?.response?.data?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (part.isLoading) return <Screen><AppHeader title="Part" /><LoadingState /></Screen>;
  if (part.error || !part.data) {
    return (
      <Screen>
        <AppHeader title="Part" />
        <ErrorState title="Could not load this part" onRetry={part.refetch} />
      </Screen>
    );
  }

  const p = part.data;
  const qty = Number(p.stock_on_hand || 0);
  const qtyTone = qty > 0 ? theme.success : qty < 0 ? theme.danger : theme.textMuted;

  return (
    <Screen>
      <AppHeader title={p.internal_sku || 'Part'} subtitle={p.display_name} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.headline}>
          <Text style={[styles.name, { color: theme.text }]}>{p.display_name}</Text>
          <View style={styles.statRow}>
            <View>
              <Text style={[styles.stat, { color: qtyTone }]}>{qty}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>On hand</Text>
            </View>
            <View>
              <Text style={[styles.statSmall, { color: theme.text }]}>{formatPHP(p.last_sale_price || 0)}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Price</Text>
            </View>
            <View>
              <Text style={[styles.statSmall, { color: theme.text }]}>{formatPHP(p.wac_cost || 0)}</Text>
              <Text style={[styles.statLabel, { color: theme.textMuted }]}>Cost</Text>
            </View>
          </View>
          {!!p.barcodes?.length && (
            <Text style={[styles.barcodes, { color: theme.textMuted }]} numberOfLines={2}>
              Barcodes: {p.barcodes.join(', ')}
            </Text>
          )}
        </Card>

        {canAdjust && (
          adjusting ? (
            <Card style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Adjust Stock</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text }]}
                value={adjustQty}
                onChangeText={setAdjustQty}
                placeholder="e.g. 5 to add, -3 to remove"
                placeholderTextColor={theme.textMuted}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text }]}
                value={adjustNote}
                onChangeText={setAdjustNote}
                placeholder="Reason for the adjustment"
                placeholderTextColor={theme.textMuted}
                multiline
              />
              <Text style={[styles.warning, { color: theme.textMuted }]}>
                Adjustments are sent immediately and cannot be queued offline — a repeated
                send would double-count the stock.
              </Text>
              <View style={styles.actions}>
                <Button
                  label="Save adjustment"
                  variant="primary"
                  size="sm"
                  loading={saving}
                  disabled={!isOnline}
                  onPress={submitAdjustment}
                  style={styles.actionBtn}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  size="sm"
                  onPress={() => setAdjusting(false)}
                  style={styles.actionBtn}
                />
              </View>
            </Card>
          ) : (
            <Button
              label={isOnline ? 'Adjust stock' : 'Adjust stock (needs connection)'}
              icon="create-outline"
              variant="secondary"
              fullWidth
              disabled={!isOnline}
              onPress={() => setAdjusting(true)}
            />
          )
        )}

        {canSeeHistory && (
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Recent Movement</Text>
            {history.isLoading ? (
              <LoadingState label="Loading movement…" />
            ) : history.error ? (
              <ErrorState title="Could not load movement" onRetry={history.refetch} />
            ) : (history.data ?? []).length === 0 ? (
              <EmptyState icon="swap-horizontal-outline" title="No movement recorded" />
            ) : (
              (history.data ?? []).slice(0, 25).map((m) => {
                const delta = Number(m.quantity);
                const tone = delta > 0 ? theme.success : theme.danger;
                return (
                  <View key={m.inv_trans_id} style={[styles.moveRow, { borderTopColor: theme.border }]}>
                    <Ionicons
                      name={delta > 0 ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                      size={20}
                      color={tone}
                    />
                    <View style={styles.moveInfo}>
                      <Text style={[styles.moveType, { color: theme.text }]}>{m.trans_type}</Text>
                      <Text style={[styles.moveMeta, { color: theme.textMuted }]} numberOfLines={1}>
                        {new Date(m.transaction_date).toLocaleDateString('en-PH')}
                        {m.reference_no ? ` · ${m.reference_no}` : ''}
                        {m.first_name ? ` · ${m.first_name} ${m.last_name ?? ''}`.trimEnd() : ''}
                      </Text>
                    </View>
                    <Text style={[styles.moveQty, { color: tone }]}>
                      {delta > 0 ? '+' : ''}{delta}
                    </Text>
                  </View>
                );
              })
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  headline: { gap: Spacing.three },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { fontSize: FontSize.xxl, fontWeight: FontWeight.heavy },
  statSmall: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  statLabel: { fontSize: FontSize.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  barcodes: { fontSize: FontSize.sm },

  section: { gap: Spacing.two },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: FontSize.base,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  warning: { fontSize: FontSize.sm, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  actionBtn: { flex: 1 },

  moveRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three,
    paddingTop: Spacing.three, marginTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  moveInfo: { flex: 1 },
  moveType: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  moveMeta: { fontSize: FontSize.xs, marginTop: 1 },
  moveQty: { fontSize: FontSize.md, fontWeight: FontWeight.heavy },
});
