import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import apiClient from '../../api/client';
import useAuthStore from '../../store/useAuthStore';
import useServerReachability from '../../hooks/useServerReachability';
import PremiumScanner from '../../components/ui/PremiumScanner';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { LoadingState, EmptyState, ErrorState } from '../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '../../utils/currency';

type PoLine = {
  po_line_id: number;
  part_id: number;
  internal_sku: string;
  display_name: string;
  quantity: string;
  quantity_received: string;
  cost_price: string | null;
  last_cost: string | null;
  last_sale_price: string | null;
};

/**
 * Scan items against a purchase order and post the receipt.
 *
 * Deliberately online-only. Posting a goods receipt allocates a GRN number,
 * writes inventory transactions, advances quantity_received on the PO and can
 * create a supplier bill -- none of which carry an idempotency key, so a
 * replayed send would receive the same stock twice. Building the draft works
 * offline; only the final post needs the server, and the button says so.
 */
export default function ReceivePoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { poId } = useLocalSearchParams() as { poId: string };
  const user = useAuthStore((s) => s.user);
  const { isOnline } = useServerReachability();

  const [received, setReceived] = useState<Record<number, string>>({});
  const [costs, setCosts] = useState<Record<number, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  const { data: lines, isLoading, error, refetch } = useQuery<PoLine[]>({
    queryKey: ['poLines', poId],
    queryFn: async () => (await apiClient.get(`/purchase-orders/${poId}/lines`)).data,
  });

  const { data: po } = useQuery({
    queryKey: ['openPurchaseOrders'],
    queryFn: async () => (await apiClient.get('/purchase-orders/open')).data,
    select: (rows: any[]) => rows.find((r) => String(r.po_id) === String(poId)),
  });

  const outstanding = (line: PoLine) =>
    Math.max(0, Number(line.quantity) - Number(line.quantity_received || 0));

  const enteredLines = useMemo(
    () => (lines ?? []).filter((l) => Number(received[l.part_id] || 0) > 0),
    [lines, received],
  );

  /** A scan fills in the outstanding quantity for the matching line. */
  const resolveBarcode = async (barcode: string) => {
    try {
      const { data } = await apiClient.get(`/parts/barcode/${encodeURIComponent(barcode)}`);
      const partId = data?.part_id ?? data?.part?.part_id;
      const line = (lines ?? []).find((l) => String(l.part_id) === String(partId));

      if (!line) {
        return {
          status: 'error' as const,
          message: 'That part is not on this purchase order.',
        };
      }

      setReceived((prev) => {
        const current = Number(prev[line.part_id] || 0);
        // Each scan counts one unit, so a box of six is six taps -- but never
        // more than the PO still expects.
        const next = Math.min(current + 1, outstanding(line) || current + 1);
        return { ...prev, [line.part_id]: String(next) };
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { status: 'success' as const };
    } catch (err: any) {
      if (err?.response?.status === 404) return { status: 'not_found' as const };
      return { status: 'error' as const, message: 'Could not check that barcode.' };
    }
  };

  const post = async () => {
    if (enteredLines.length === 0) {
      return Alert.alert('Nothing to receive', 'Enter or scan at least one quantity.');
    }

    const missingCost = enteredLines.find(
      (l) => !Number(costs[l.part_id] ?? l.cost_price ?? l.last_cost ?? 0),
    );
    if (missingCost) {
      return Alert.alert(
        'Cost required',
        `Enter a unit cost for ${missingCost.internal_sku} — stock cannot be valued without it.`,
      );
    }

    Alert.alert(
      'Post this receipt?',
      `${enteredLines.length} line${enteredLines.length === 1 ? '' : 's'} will be received into stock. This cannot be undone from the app.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Post receipt', onPress: doPost },
      ],
    );
  };

  const doPost = async () => {
    setPosting(true);
    try {
      await apiClient.post('/goods-receipts', {
        supplier_id: po?.supplier_id,
        received_by: user?.employee_id,
        po_id: Number(poId),
        lines: enteredLines.map((l) => ({
          part_id: l.part_id,
          quantity: Number(received[l.part_id]),
          cost_price: Number(costs[l.part_id] ?? l.cost_price ?? l.last_cost ?? 0),
          sale_price: l.last_sale_price ? Number(l.last_sale_price) : null,
        })),
      });

      queryClient.invalidateQueries({ queryKey: ['openPurchaseOrders'] });
      queryClient.invalidateQueries({ queryKey: ['poLines', poId] });
      Alert.alert('Receipt posted', 'Stock has been received.', [
        { text: 'OK', onPress: () => router.replace('/receiving') },
      ]);
    } catch (err: any) {
      Alert.alert('Could not post receipt', err?.response?.data?.message || 'Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const renderLine = ({ item }: { item: PoLine }) => {
    const left = outstanding(item);
    const done = left === 0;

    return (
      <Card style={styles.lineCard}>
        <Text style={[styles.lineName, { color: theme.text }]} numberOfLines={2}>{item.display_name}</Text>
        <Text style={[styles.lineSku, { color: theme.textMuted }]}>{item.internal_sku}</Text>

        <View style={styles.lineMeta}>
          <Text style={[styles.metaText, { color: theme.textSecondary }]}>
            Ordered {Number(item.quantity)} · Received {Number(item.quantity_received || 0)}
          </Text>
          <Text style={[styles.metaText, { color: done ? theme.success : theme.warning }]}>
            {done ? 'Complete' : `${left} outstanding`}
          </Text>
        </View>

        <View style={styles.inputRow}>
          <View style={styles.inputCol}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Receiving</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text }]}
              value={received[item.part_id] ?? ''}
              onChangeText={(v) => setReceived((p) => ({ ...p, [item.part_id]: v.replace(/[^0-9.]/g, '') }))}
              placeholder="0"
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.inputCol}>
            <Text style={[styles.inputLabel, { color: theme.textMuted }]}>Unit cost</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text }]}
              value={costs[item.part_id] ?? (item.cost_price ? String(Number(item.cost_price)) : '')}
              onChangeText={(v) => setCosts((p) => ({ ...p, [item.part_id]: v.replace(/[^0-9.]/g, '') }))}
              placeholder={item.last_cost ? String(Number(item.last_cost)) : '0.00'}
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity
            style={[styles.fillBtn, { backgroundColor: theme.primarySoft }]}
            onPress={() => setReceived((p) => ({ ...p, [item.part_id]: String(left) }))}
            disabled={done}
            accessibilityLabel={`Receive all ${left} outstanding`}
          >
            <Text style={[styles.fillText, { color: theme.primary }]}>All</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  if (isLoading) return <Screen><AppHeader title="Receive" /><LoadingState /></Screen>;
  if (error) {
    return (
      <Screen>
        <AppHeader title="Receive" />
        <ErrorState title="Could not load this purchase order" onRetry={refetch} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title={po?.po_number || `PO ${poId}`}
        subtitle={po?.supplier_name}
        right={
          <TouchableOpacity onPress={() => setScannerOpen(true)} accessibilityLabel="Scan an item">
            <Ionicons name="barcode-outline" size={24} color={theme.primary} />
          </TouchableOpacity>
        }
      />

      <FlatList
        data={lines ?? []}
        keyExtractor={(item) => String(item.po_line_id)}
        renderItem={renderLine}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState icon="list-outline" title="This purchase order has no lines" />}
      />

      <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        {!isOnline && (
          <Text style={[styles.offlineNote, { color: theme.warning }]}>
            Receiving must be posted while connected — a repeated send would receive the stock twice.
          </Text>
        )}
        <Button
          label={
            enteredLines.length
              ? `Post receipt (${enteredLines.length} line${enteredLines.length === 1 ? '' : 's'})`
              : 'Post receipt'
          }
          icon="checkmark-circle"
          fullWidth
          loading={posting}
          disabled={!isOnline || enteredLines.length === 0}
          onPress={post}
        />
      </View>

      <PremiumScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onBarcodeScanned={() => {}}
        onResolveBarcode={resolveBarcode}
        title="Scan to Receive"
        autoCloseOnSuccess={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  lineCard: { gap: Spacing.one },
  lineName: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  lineSku: { fontSize: FontSize.sm },
  lineMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.one },
  metaText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, marginTop: Spacing.two },
  inputCol: { flex: 1 },
  inputLabel: { fontSize: FontSize.xs, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: FontSize.base,
  },
  fillBtn: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, borderRadius: Radius.sm },
  fillText: { fontSize: FontSize.sm, fontWeight: FontWeight.heavy },
  footer: { padding: Spacing.four, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  offlineNote: { fontSize: FontSize.sm, lineHeight: 18 },
});
