import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '../ui/Card';
import StatusBadge, { toneForStatus } from '../ui/StatusBadge';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '@/utils/currency';
import type { PurchaseOrder } from '@/utils/purchaseOrder';

export default function PurchaseOrderCard({ order, onPress }: { order: PurchaseOrder; onPress: () => void }) {
  const theme = useTheme();
  return <Card onPress={onPress} style={styles.card}>
    <View style={styles.row}><Text style={[styles.title, { color: theme.text }]}>{order.po_number || `PO ${order.po_id}`}</Text><StatusBadge label={order.status} tone={toneForStatus(order.status)} /></View>
    <Text style={[styles.supplier, { color: theme.textSecondary }]} numberOfLines={1}>{order.supplier_name}</Text>
    <View style={styles.row}><Text style={[styles.meta, { color: theme.textMuted }]}>{new Date(order.order_date).toLocaleDateString('en-PH')}</Text><Text style={[styles.total, { color: theme.text }]}>{formatPHP(order.total_amount || 0)}</Text></View>
  </Card>;
}
const styles = StyleSheet.create({ card: { gap: Spacing.one }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two }, title: { fontSize: FontSize.base, fontWeight: FontWeight.bold, flex: 1 }, supplier: { fontSize: FontSize.sm }, meta: { fontSize: FontSize.xs }, total: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold } });
