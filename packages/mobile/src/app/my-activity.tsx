import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  ScrollView,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';

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

type SaleItem = {
  id: number;
  staged_date: string;
  total_amount: number;
  total_formatted: string;
  status: string;
  physical_receipt_no: string | null;
  customer_name: string;
};

type SalesActivity = {
  stats: {
    total_pending: number;
    total_approved: number;
    total_rejected: number;
    total_revenue: number;
  };
  items: SaleItem[];
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:                { label: 'Pending',         color: '#6b7280', bg: '#f3f4f6' },
  PENDING_MANAGER_REVIEW: { label: 'Awaiting Review', color: '#d97706', bg: '#fffbeb' },
  MATCHED_AUTO_APPROVED:  { label: 'Matched ✓',       color: '#2563eb', bg: '#eff6ff' },
  APPROVED_ADJUSTED:      { label: 'Approved ✓',      color: '#16a34a', bg: '#f0fdf4' },
  RECOUNT_REQUESTED:      { label: 'Recount',         color: '#b45309', bg: '#fef3c7' },
};

const SALE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:  { label: 'Pending',  color: '#d97706', bg: '#fffbeb' },
  APPROVED: { label: 'Approved', color: '#16a34a', bg: '#f0fdf4' },
  REJECTED: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
};

type Filter = 'all' | 'pending' | 'done';
type MainTab = 'counts' | 'sales';

const fetchProgress = async (): Promise<CountLine[]> => {
  const { data } = await apiClient.get('/inventory/cycle-count/my-progress');
  return data.filter((l: CountLine) => l.status !== 'PENDING');
};

const fetchMySalesActivity = async (): Promise<SalesActivity> => {
  const { data } = await apiClient.get('/sales/staging/my-activity');
  return data;
};

const patchEditCount = async ({ lineId, countedQty }: { lineId: number; countedQty: number }) => {
  const { data } = await apiClient.patch(
    `/inventory/cycle-count/lines/${lineId}/edit-count`,
    { counted_qty: countedQty }
  );
  return data;
};

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

            {item.status !== 'PENDING_MANAGER_REVIEW' && (
              <View style={ms.modalInfo}>
                <Text style={ms.infoLabel}>System Qty</Text>
                <Text style={ms.infoValue}>{item.system_qty_snapshot ?? '—'}</Text>
              </View>
            )}

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

export default function MyActivityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: layoutWidth } = useWindowDimensions();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const [mainTab, setMainTab] = useState<MainTab>('counts');
  const [filter, setFilter] = useState<Filter>('all');
  const [editingItem, setEditingItem] = useState<CountLine | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: items = [], isLoading, error, refetch } = useQuery({
    queryKey: ['myProgress'],
    queryFn: fetchProgress,
  });

  const {
    data: salesData,
    isLoading: salesLoading,
    error: salesError,
    refetch: refetchSales,
  } = useQuery({
    queryKey: ['mySalesActivity'],
    queryFn: fetchMySalesActivity,
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
    try {
      await Promise.all([refetch(), refetchSales()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchSales]);

  const pendingCount = items.filter(i => i.status === 'PENDING_MANAGER_REVIEW').length;
  const doneCount    = items.filter(i => i.status !== 'PENDING_MANAGER_REVIEW').length;
  const pendingItems = items.filter(i => i.status === 'PENDING_MANAGER_REVIEW');
  const doneItems    = items.filter(i => i.status !== 'PENDING_MANAGER_REVIEW');

  const stats = salesData?.stats ?? { total_pending: 0, total_approved: 0, total_rejected: 0, total_revenue: 0 };
  const salesItems = salesData?.items ?? [];

  const handleTabPress = (key: Filter) => {
    setFilter(key);
    const keys: Filter[] = ['all', 'pending', 'done'];
    const index = keys.indexOf(key);
    scrollViewRef.current?.scrollTo({ x: index * layoutWidth, animated: true });
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffset = e.nativeEvent.contentOffset.x;
    const page = Math.round(contentOffset / layoutWidth);
    const keys: Filter[] = ['all', 'pending', 'done'];
    const newFilter = keys[page];
    if (newFilter && newFilter !== filter) {
      setFilter(newFilter);
    }
  };

  useEffect(() => {
    const keys: Filter[] = ['all', 'pending', 'done'];
    const index = keys.indexOf(filter);
    scrollViewRef.current?.scrollTo({ x: index * layoutWidth, animated: false });
  }, [layoutWidth]);

  const translateX = scrollX.interpolate({
    inputRange: [0, layoutWidth, layoutWidth * 2],
    outputRange: [0, layoutWidth / 3, (layoutWidth / 3) * 2],
    extrapolate: 'clamp',
  });

  const renderCountItem = ({ item }: { item: CountLine }) => {
    const meta = STATUS_META[item.status] || STATUS_META['PENDING'];
    const v = parseFloat(item.variance_qty ?? '0');
    const varColor = v < 0 ? '#dc2626' : v > 0 ? '#16a34a' : '#6b7280';
    const canEdit = item.status === 'PENDING_MANAGER_REVIEW';

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
            <Text style={[styles.cellValue, item.status === 'PENDING_MANAGER_REVIEW' && styles.cellValueHidden]}>
              {item.status === 'PENDING_MANAGER_REVIEW' ? 'hidden' : (item.system_qty_snapshot ?? '—')}
            </Text>
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

  const renderSaleItem = ({ item }: { item: SaleItem }) => {
    const meta = SALE_STATUS_META[item.status] || { label: item.status, color: '#6b7280', bg: '#f3f4f6' };

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.partName} numberOfLines={1}>
            {item.customer_name}
          </Text>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <View style={styles.saleMeta}>
          <Ionicons name="calendar-outline" size={13} color="#9ca3af" />
          <Text style={styles.saleDate}>
            {new Date(item.staged_date).toLocaleDateString('en-PH', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>

        <View style={styles.saleDetailRow}>
          <Text style={styles.saleAmount}>{item.total_formatted}</Text>
          {item.physical_receipt_no && (
            <Text style={styles.saleReceipt}>#{item.physical_receipt_no}</Text>
          )}
        </View>
      </View>
    );
  };

  const cyclesTab = (data: CountLine[]) => (
    <FlatList
      data={data}
      keyExtractor={i => i.line_id.toString()}
      renderItem={renderCountItem}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No items to show.</Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );

  const renderKpiStrip = () => {
    const revenueFormatted = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(stats.total_revenue);

    return (
      <View style={styles.kpiGrid}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#eff6ff' }]}>
              <Ionicons name="checkmark-done" size={18} color="#2563eb" />
            </View>
            <View>
              <Text style={styles.kpiValue}>{items.length}</Text>
              <Text style={styles.kpiLabel}>Counted Lines</Text>
            </View>
          </View>
          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#fffbeb' }]}>
              <Ionicons name="time" size={18} color="#d97706" />
            </View>
            <View>
              <Text style={styles.kpiValue}>{pendingCount}</Text>
              <Text style={styles.kpiLabel}>Pending Review</Text>
            </View>
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#f0fdf4' }]}>
              <Ionicons name="cart" size={18} color="#16a34a" />
            </View>
            <View>
              <Text style={styles.kpiValue}>{stats.total_pending}</Text>
              <Text style={styles.kpiLabel}>Sales Staged</Text>
            </View>
          </View>
          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#fdf2f8' }]}>
              <Ionicons name="wallet" size={18} color="#db2777" />
            </View>
            <View>
              <Text style={styles.kpiValue}>{revenueFormatted}</Text>
              <Text style={styles.kpiLabel}>Sales Revenue</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Activity</Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView style={styles.scrollBody} bounces={false}>
        {renderKpiStrip()}

        <View style={styles.mainTabBar}>
          <TouchableOpacity
            style={[styles.mainTabBtn, mainTab === 'counts' && styles.mainTabBtnActive]}
            onPress={() => setMainTab('counts')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="analytics"
              size={16}
              color={mainTab === 'counts' ? '#2563eb' : '#6b7280'}
            />
            <Text style={[styles.mainTabText, mainTab === 'counts' && styles.mainTabTextActive]}>
              Cycle Counts
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mainTabBtn, mainTab === 'sales' && styles.mainTabBtnActive]}
            onPress={() => setMainTab('sales')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="receipt"
              size={16}
              color={mainTab === 'sales' ? '#2563eb' : '#6b7280'}
            />
            <Text style={[styles.mainTabText, mainTab === 'sales' && styles.mainTabTextActive]}>
              Sales Activity
            </Text>
          </TouchableOpacity>
        </View>

        {mainTab === 'counts' ? (
          <View>
            <View style={styles.tabContainer}>
              <View style={styles.filterRow}>
                {([
                  { key: 'all',     label: `All (${items.length})` },
                  { key: 'pending', label: `Pending Review (${pendingCount})` },
                  { key: 'done',    label: `Approved (${doneCount})` },
                ] as { key: Filter; label: string }[]).map(({ key, label }) => (
                  <TouchableOpacity
                    key={key}
                    style={styles.filterBtn}
                    onPress={() => handleTabPress(key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterBtnText, filter === key && styles.filterBtnTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Animated.View
                style={[
                  styles.indicator,
                  {
                    width: layoutWidth / 3,
                    transform: [{ translateX }],
                  },
                ]}
              />
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
              <Animated.ScrollView
                ref={scrollViewRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                  { useNativeDriver: true }
                )}
                onMomentumScrollEnd={onScrollEnd}
                bounces={false}
                scrollEventThrottle={16}
                style={styles.subScrollView}
              >
                <View style={{ width: layoutWidth, minHeight: 300 }}>
                  {cyclesTab(items)}
                </View>
                <View style={{ width: layoutWidth, minHeight: 300 }}>
                  {cyclesTab(pendingItems)}
                </View>
                <View style={{ width: layoutWidth, minHeight: 300 }}>
                  {cyclesTab(doneItems)}
                </View>
              </Animated.ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.salesSection}>
            {salesLoading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#3b82f6" />
              </View>
            ) : salesError ? (
              <View style={styles.center}>
                <Text style={styles.errorText}>Failed to load sales activity.</Text>
                <TouchableOpacity onPress={() => refetchSales()} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={salesItems}
                keyExtractor={i => i.id.toString()}
                renderItem={renderSaleItem}
                contentContainerStyle={styles.list}
                scrollEnabled={false}
                ListEmptyComponent={
                  <View style={styles.center}>
                    <Ionicons name="receipt-outline" size={40} color="#d1d5db" />
                    <Text style={styles.emptyText}>No sales activity yet.</Text>
                  </View>
                }
              />
            )}
          </View>
        )}
      </ScrollView>

      {editingItem && (
        <EditCountModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={(qty) => mutation.mutate({ lineId: editingItem.line_id, countedQty: qty })}
        />
      )}

      {mutation.isPending && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:     { flex: 1, backgroundColor: '#f3f4f6' },
  scrollBody:   { flex: 1 },
  subScrollView: { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', justifyContent: 'space-between' },
  headerTitle:  { fontSize: 18, fontWeight: 'bold', color: '#111827' },
  backBtn:      { paddingVertical: 4, paddingHorizontal: 2 },
  backBtnText:  { fontSize: 14, color: '#3b82f6', fontWeight: '600' },

  kpiGrid:  { padding: 12, paddingBottom: 4, gap: 8 },
  kpiRow:   { flexDirection: 'row', gap: 10 },
  kpiCard:  { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', gap: 10, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3 },
  kpiIconBox: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  kpiValue: { fontSize: 16, fontWeight: '800', color: '#111827' },
  kpiLabel: { fontSize: 10, color: '#6b7280', marginTop: 1 },

  mainTabBar: { flexDirection: 'row', marginHorizontal: 12, marginTop: 4, marginBottom: 8, backgroundColor: '#e5e7eb', borderRadius: 10, padding: 3 },
  mainTabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  mainTabBtnActive: { backgroundColor: '#fff', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  mainTabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  mainTabTextActive: { color: '#2563eb' },

  tabContainer: { position: 'relative', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  filterRow:   { flexDirection: 'row' },
  filterBtn:   { flex: 1, paddingVertical: 12, alignItems: 'center' },
  filterBtnText:       { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  filterBtnTextActive: { color: '#2563eb', fontWeight: '700' },
  indicator:   { position: 'absolute', bottom: 0, height: 3, backgroundColor: '#3b82f6', borderRadius: 1.5 },

  salesSection: { paddingBottom: 32 },
  saleMeta:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  saleDate:    { fontSize: 12, color: '#6b7280' },
  saleDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saleAmount:  { fontSize: 16, fontWeight: '700', color: '#111827' },
  saleReceipt: { fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' },

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
  cellValueHidden: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
  editBtn:     { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  editBtnText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  timestamp:   { fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'right' },
  center:    { justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#9ca3af', fontSize: 15, marginTop: 8 },
  errorText: { color: '#ef4444', fontSize: 15, marginBottom: 12 },
  retryBtn:     { backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  savingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', gap: 12 },
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
