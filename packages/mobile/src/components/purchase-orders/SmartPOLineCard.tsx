import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '@/utils/currency';
import type { SmartPOLine } from '@/utils/purchaseOrder';
const tone = (status: string) => status === 'exact' || status === 'ai' ? 'success' : status === 'fuzzy' || status === 'ambiguous' ? 'warning' : 'info' as const;
export default function SmartPOLineCard({ line, onEdit, onRemove }: { line: SmartPOLine; onEdit: () => void; onRemove: () => void }) {
  const theme = useTheme();
  return <Card style={styles.card}><View style={styles.row}><Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{line.display_name}</Text><StatusBadge label={line.match_status === 'unresolved' ? 'draft' : line.match_status} tone={tone(line.match_status)} /></View><Text style={[styles.meta, { color: theme.textSecondary }]}>{line.quantity} {line.unit || 'PCS'} × {formatPHP(line.cost_price)}</Text><View style={styles.actions}><TouchableOpacity onPress={onEdit} accessibilityLabel={`Edit ${line.display_name}`}><Text style={[styles.link, { color: theme.primary }]}>Edit</Text></TouchableOpacity><TouchableOpacity onPress={onRemove} accessibilityLabel={`Remove ${line.display_name}`}><Ionicons name="trash-outline" size={19} color={theme.danger} /></TouchableOpacity></View></Card>;
}
const styles = StyleSheet.create({ card: { gap: Spacing.two }, row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two }, name: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold }, meta: { fontSize: FontSize.sm }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.four, alignItems: 'center' }, link: { fontSize: FontSize.sm, fontWeight: FontWeight.bold } });
