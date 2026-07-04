import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import apiClient from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────
type CountLine = {
  line_id: number;
  part_id: number;
  batch_id: number;
  status: string;
  display_name: string;
  internal_sku: string;
  system_qty_snapshot: string | null;
  counted_qty: string | null;
  variance_qty: string | null;
  counted_at: string | null;
};

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:                { label: 'Pending',         color: '#6b7280', bg: '#f3f4f6' },
  PENDING_MANAGER_REVIEW: { label: 'Awaiting Review', color: '#d97706', bg: '#fffbeb' },
  MATCHED_AUTO_APPROVED:  { label: 'Matched ✓',       color: '#2563eb', bg: '#eff6ff' },
  APPROVED_ADJUSTED:      { label: 'Approved ✓',      color: '#16a34a', bg: '#f0fdf4' },
  RECOUNT_REQUESTED:      { label: 'Recount',         color: '#b45309', bg: '#fef3c7' },
};

// ── API calls ────────────────────────────────────────────────────────────────
const fetchProgress = async (): Promise<CountLine[]> => {
  const { data } = await apiClient.get('/inventory/cycle-count/my-progress');
  return data;
};

const patchEditCount = async ({ lineId, countedQty }: { lineId: number; countedQty: number }) => {
  const { data } = await apiClient.patch(
    `/inventory/cycle-count/lines/${lineId}/edit-count`,
    { counted_qty: countedQty }
  );
  return data;
};

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditCountModal({
  item,
  onClose,
  onSave,
}: {
  item: CountLine;
  onClose: () => void;
  onSave: (qty: number) => void;
}) {
  const [value, setValue] = useState(item.counted_qty ?? '');

  const handleSave = () => {
    const qty = parseFloat(value);
    if (isNaN(qty) || qty < 0) {
      Alert.alert('Invalid', 'Please enter a valid count (0 or more).');
      return;
    }
    onSave(qty);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={ms.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={ms.modalCard}>
            <Text style={ms.modalTitle}>Edit Count</Text>
            <Text style={ms.modalPart} numberOfLines={2}>
              {item.display_name || item.internal_sku}
            </Text>
            <Text style={ms.modalSku}>{item.internal_sku}</Text>

            <View style={ms.modalInfo}>
              <Text style={ms.infoLabel}>System Qty</Text>
              <Text style={ms.infoValue}>{item.system_qty_snapshot ?? '—'}</Text>
            </View>

            <Text style={ms.inputLabel}>New Count</Text>
            <TextInput
              style={ms.input}
              keyboardType="numeric"
              value={String(value)}
              onChangeText={setValue}
              placeholder="Enter quantity"
              autoFocus
              selectTextOnFocus
            />

            <View style={ms.modalActions}>
              <TouchableOpacity style={ms.cancelBtn} onPress={onClose}>
                <Text style={ms.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ms.saveBtn} onPress={handleSave}>
                <Text style={ms.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
type Filter = 'all' | 'pending' | 'done';

export default function MyProgressScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>('all');
  const [editingItem, setEditingItem] = useState<CountLine | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: items = [], isLoading, error, refetch } = useQuery({
    queryKey: ['myProgress'],
    queryFn: fetchProgress,
  });

  const mutation = useMutation({
    mutationFn: patchEditCount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myProgress'] });
      queryClient.invalidateQueries({ queryKey: ['assignedTasks'] });
      setEditingItem(null);
      Alert.alert('Success', 'Count updated successfully.');
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to save count.');
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const pendingCount = items.filter(i => i.status === 'PENDING').length;
  const doneCount    = items.filter(i => i.status !== 'PENDING').length;

  const filtered = items.filter(i => {
    if (filter === 'pending') return i.status === 'PENDING';
    if (filter === 'done')    return i.status !== 'PENDING';
    return true;
  });

  const renderItem = ({ item }: { item: CountLine }) => {
    const meta = STATUS_META[item.status] || STATUS_META['PENDING'];
    const v = parseFloat(item.variance_qty ?? '0');
    const varColor = v < 0 ? '#dc2626' : v > 0 ? '#16a34a' : '#6b7280';
    const canEdit = item.status === 'PENDING';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.partName} numberOfLines={2}>
            {item.display_name || item.internal_sku}
          </Text>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <Text style={styles.sku}>{item.internal_sku}</Text>

        <View style={styles.row}>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>System</Text>
            <Text style={styles.cellValue}>{item.system_qty_snapshot ?? '—'}</Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Counted</Text>
            <Text style={[styles.cellValue, styles.cellValueBold]}>
              {item.counted_qty ?? '—'}
            </Text>
          </View>
          <View style={styles.cell}>
            <Text style={styles.cellLabel}>Variance</Text>
            <Text style={[styles.cellValue, styles.cellValueBold, { color: varColor }]}>
              {canEdit ? '—' : v > 0 ? `+${v}` : String(v)}
            </Text>
          </View>
        </View>

        {canEdit && (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => setEditingItem(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.editBtnText}>✏  Edit Count</Text>
          </TouchableOpacity>
        )}

        {item.counted_at && (
          <Text style={styles.timestamp}>
            Counted: {new Date(item.counted_at).toLocaleString()}
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Progress</Text>
        <View style={{ width: 64 }} />
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {([
          { key: 'all',     label: `All (${items.length})` },
          { key: 'pending', label: `Pending (${pendingCount})` },
          { key: 'done',    label: `Done (${doneCount})` },
        ] as { key: Filter; label: string }[]).map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.filterBtn, filter === key && styles.filterBtnActive]}
            onPress={() => setFilter(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterBtnText, filter === key && styles.filterBtnTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Failed to load progress.</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.line_id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No items to show.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {/* Edit modal */}
      {editingItem && (
        <EditCountModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={(qty) => mutation.mutate({ lineId: editingItem.line_id, countedQty: qty })}
        />
      )}

      {/* Saving overlay */}
      {mutation.isPending && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea:    { flex: 1, backgroundColor: '#f3f4f6' },
  header:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  backBtn:     { paddingVertical: 4, paddingHorizontal: 2 },
  backBtnText: { fontSize: 14, color: '#3b82f6', fontWeight: '600' },
  filterRow:   { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  filterBtn:   { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterBtnActive:     { borderBottomColor: '#3b82f6' },
  filterBtnText:       { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  filterBtnTextActive: { color: '#2563eb', fontWeight: '700' },
  list:     { padding: 12, paddingBottom: 24 },
  card:     { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  partName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#111827', marginRight: 8 },
  sku:      { fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', marginBottom: 12 },
  badge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  row:  { flexDirection: 'row', marginBottom: 12 },
  cell: { flex: 1, alignItems: 'center' },
  cellLabel:     { fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  cellValue:     { fontSize: 16, color: '#374151' },
  cellValueBold: { fontWeight: '700' },
  editBtn:     { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  editBtnText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  timestamp:   { fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'right' },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#9ca3af', fontSize: 15 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 12 },
  retryBtn:     { backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  savingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', gap: 12 },
  savingText:    { color: '#fff', fontSize: 16, fontWeight: '600' },
});

const ms = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard:  { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 8 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  modalPart:  { fontSize: 15, color: '#374151', marginBottom: 2 },
  modalSku:   { fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', marginBottom: 16 },
  modalInfo:  { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f9fafb', borderRadius: 8, padding: 10, marginBottom: 16 },
  infoLabel:  { fontSize: 12, color: '#6b7280' },
  infoValue:  { fontSize: 14, fontWeight: '600', color: '#374151' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input:      { borderWidth: 1.5, borderColor: '#3b82f6', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 22, fontWeight: 'bold', color: '#111827', textAlign: 'center', marginBottom: 20 },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn:    { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText:{ fontSize: 15, fontWeight: '700', color: '#374151' },
  saveBtn:      { flex: 1, backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  saveBtnText:  { fontSize: 15, fontWeight: '700', color: '#fff' },
});
