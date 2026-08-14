import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Modal, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';
import useAuthStore from '../store/useAuthStore';
import useOutboxStore from '../offline/outbox';
import { usePermission } from '../hooks/usePermission';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight, elevation } from '@/constants/theme';
import Screen from '../components/ui/Screen';
import Card from '../components/ui/Card';
import { LoadingState, EmptyState, ErrorState } from '../components/ui/States';

const fetchAssignedTasks = async () => {
  const { data } = await apiClient.get('/inventory/cycle-count/my-tasks');
  return data;
};

type Module = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  accent: string;
  /** Any one of these grants the tile. Absent means always visible. */
  permission?: string[];
};

export default function DashboardScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { setActiveBatch } = useCycleCountStore();
  const { user, logout } = useAuthStore();
  const { hasAny } = usePermission();
  const queuedCount = useOutboxStore((s) => s.entries.length);

  const { data: tasks, isLoading, error, refetch } = useQuery({
    queryKey: ['assignedTasks'],
    queryFn: fetchAssignedTasks,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [isProfileMenuVisible, setProfileMenuVisible] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } catch {
      // A failed refresh is not worth an error state; the cached list stands.
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  /**
   * Every module the app offers, filtered by permission.
   *
   * Declared as data rather than hand-written JSX rows so adding a module is a
   * one-line change and the grid stays balanced no matter how many tiles a
   * given role can actually see.
   */
  const MODULES: Module[] = [
    {
      key: 'hr', title: 'My HR', subtitle: 'Clock in, payslips, leave',
      icon: 'person-circle', route: '/hr', accent: theme.info,
      permission: ['dtr:punch', 'payslip:view_own', 'leave:request'],
    },
    {
      key: 'pos', title: 'Point of Sale', subtitle: 'Checkout & invoices',
      icon: 'cart', route: '/pos', accent: theme.success, permission: ['pos:use'],
    },
    {
      key: 'stock', title: 'Stock Lookup', subtitle: 'Scan & check on hand',
      icon: 'search', route: '/stock', accent: theme.primary, permission: ['inventory:view'],
    },
    {
      key: 'unassigned', title: 'Log Unassigned', subtitle: 'Cycle count ad-hoc',
      icon: 'barcode', route: '/unassigned-search', accent: theme.warning,
      permission: ['cycle_count:execute'],
    },
    {
      key: 'receiving', title: 'Receiving', subtitle: 'Receive against a PO',
      icon: 'archive', route: '/receiving', accent: theme.accent,
      permission: ['goods_receipt:create'],
    },
    {
      key: 'activity', title: 'My Activity', subtitle: 'Counts & sales',
      icon: 'stats-chart', route: '/my-activity', accent: theme.info,
      permission: ['pos:use', 'cycle_count:execute'],
    },
    {
      key: 'settings', title: 'Settings', subtitle: 'Server & network',
      icon: 'settings', route: '/settings', accent: theme.textMuted,
    },
  ];

  const visibleModules = MODULES.filter((m) => !m.permission || hasAny(m.permission));

  const handleTaskPress = (task: any) => {
    const batchData = tasks.filter((t: any) => t.batch_id === task.batch_id);
    setActiveBatch(task.batch_id, batchData, task.line_id);
    router.push('/count');
  };

  const renderItem = ({ item }: { item: any }) => (
    <Card onPress={() => handleTaskPress(item)} style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <Ionicons name="clipboard-outline" size={20} color={theme.primary} />
        <Text style={[styles.taskTitle, { color: theme.text }]} numberOfLines={1}>
          {item.display_name}
        </Text>
      </View>
      <View style={[styles.taskDetails, { backgroundColor: theme.surfaceSunken }]}>
        <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
          Part <Text style={{ color: theme.textSecondary, fontWeight: FontWeight.semibold }}>{item.part_id}</Text>
        </Text>
        <Text style={[styles.detailLabel, { color: theme.textMuted }]}>
          Batch <Text style={{ color: theme.textSecondary, fontWeight: FontWeight.semibold }}>{item.batch_id}</Text>
        </Text>
      </View>
    </Card>
  );

  const renderHeader = () => {
    const pendingBatches = new Set(tasks?.map((t: any) => t.batch_id)).size || 0;

    return (
      <View style={styles.headerContainer}>
        <Card style={styles.welcomeBanner}>
          <Text style={[styles.welcomeGreeting, { color: theme.text }]}>
            Hello, {user?.first_name || 'Team Member'} 👋
          </Text>
          <Text style={[styles.welcomeSubtitle, { color: theme.textMuted }]}>
            Forson Auto Parts ERP Gateway
          </Text>
        </Card>

        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Operational Modules</Text>
        <View style={styles.grid}>
          {visibleModules.map((mod) => (
            <Card
              key={mod.key}
              accent={mod.accent}
              onPress={() => router.push(mod.route as never)}
              style={styles.gridCard}
            >
              <View style={[styles.iconBox, { backgroundColor: theme.surfaceSunken }]}>
                <Ionicons name={mod.icon} size={22} color={mod.accent} />
              </View>
              <Text style={[styles.gridTitle, { color: theme.text }]}>{mod.title}</Text>
              <Text style={[styles.gridSubtitle, { color: theme.textMuted }]}>{mod.subtitle}</Text>
            </Card>
          ))}
        </View>

        {hasAny(['cycle_count:execute']) && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Inventory Count Summary</Text>
            <View style={styles.summaryRow}>
              <Card style={styles.summaryCard}>
                <View style={[styles.statIconBox, { backgroundColor: theme.primarySoft }]}>
                  <Ionicons name="list" size={18} color={theme.primary} />
                </View>
                <View>
                  <Text style={[styles.summaryValue, { color: theme.text }]}>{tasks?.length || 0}</Text>
                  <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Assigned Lines</Text>
                </View>
              </Card>
              <Card style={styles.summaryCard}>
                <View style={[styles.statIconBox, { backgroundColor: theme.infoSoft }]}>
                  <Ionicons name="layers" size={18} color={theme.info} />
                </View>
                <View>
                  <Text style={[styles.summaryValue, { color: theme.text }]}>{pendingBatches}</Text>
                  <Text style={[styles.summaryLabel, { color: theme.textMuted }]}>Pending Batches</Text>
                </View>
              </Card>
            </View>

            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Your Assigned Count Tasks</Text>
          </>
        )}
      </View>
    );
  };

  if (isLoading) {
    return <Screen><LoadingState label="Loading your work…" /></Screen>;
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      <View style={[styles.topHeader, { backgroundColor: theme.surface, borderBottomColor: theme.border }, elevation(1)]}>
        <Text style={[styles.topHeaderTitle, { color: theme.text }]}>FORSON ERP</Text>
        <View style={styles.headerActions}>
          {queuedCount > 0 && (
            <TouchableOpacity
              onPress={() => router.push('/outbox')}
              accessibilityLabel={`${queuedCount} items waiting to sync`}
              style={styles.queueBtn}
            >
              <Ionicons name="cloud-upload-outline" size={22} color={theme.warning} />
              <View style={[styles.queueBadge, { backgroundColor: theme.warning }]}>
                <Text style={styles.queueBadgeText}>{queuedCount}</Text>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setProfileMenuVisible(true)} accessibilityLabel="Profile menu">
            <Ionicons name="person-circle-outline" size={30} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={tasks || []}
        keyExtractor={(item) => String(item.line_id)}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          error ? (
            <ErrorState
              title="Could not load your tasks"
              description={(error as Error).message}
              onRetry={refetch}
            />
          ) : hasAny(['cycle_count:execute']) ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="All caught up"
              description="You have no assigned count tasks right now."
            />
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.primary]} tintColor={theme.primary} />
        }
      />

      <Modal
        visible={isProfileMenuVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setProfileMenuVisible(false)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
          activeOpacity={1}
          onPress={() => setProfileMenuVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>User Account</Text>

            {[
              { label: 'My Profile', icon: 'person-outline' as const, route: '/profile' },
              { label: 'Pending Sync', icon: 'cloud-upload-outline' as const, route: '/outbox' },
              { label: 'Settings', icon: 'settings-outline' as const, route: '/settings' },
            ].map((item) => (
              <TouchableOpacity
                key={item.route}
                style={[styles.menuButton, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
                onPress={() => {
                  setProfileMenuVisible(false);
                  router.push(item.route as never);
                }}
              >
                <Ionicons name={item.icon} size={20} color={theme.primary} />
                <Text style={[styles.menuButtonText, { color: theme.textSecondary }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}

            <View style={[styles.modalDivider, { backgroundColor: theme.border }]} />

            <TouchableOpacity
              style={[styles.menuButton, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}
              onPress={async () => {
                setProfileMenuVisible(false);
                await logout();
              }}
            >
              <Ionicons name="log-out-outline" size={20} color={theme.danger} />
              <Text style={[styles.menuButtonText, { color: theme.danger, fontWeight: FontWeight.bold }]}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topHeaderTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy, letterSpacing: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  queueBtn: { position: 'relative' },
  queueBadge: {
    position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16,
    borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  queueBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.heavy },

  headerContainer: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  welcomeBanner: { marginBottom: Spacing.five },
  welcomeGreeting: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  welcomeSubtitle: { fontSize: FontSize.base, marginTop: Spacing.one },

  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.heavy,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: Spacing.three,
    marginTop: Spacing.three,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginBottom: Spacing.four },
  // Two per row, accounting for the gap between them.
  gridCard: { width: '48%', flexGrow: 1 },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three,
  },
  gridTitle: { fontSize: FontSize.base, fontWeight: FontWeight.heavy },
  gridSubtitle: { fontSize: FontSize.xs, marginTop: Spacing.half },

  summaryRow: { flexDirection: 'row', gap: Spacing.three, marginBottom: Spacing.five },
  summaryCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  statIconBox: { width: 34, height: 34, borderRadius: Radius.sm, justifyContent: 'center', alignItems: 'center' },
  summaryValue: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  summaryLabel: { fontSize: FontSize.xs, marginTop: 1 },

  listContainer: { paddingBottom: Spacing.six, flexGrow: 1 },
  taskCard: { marginHorizontal: Spacing.four, marginBottom: Spacing.three },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  taskTitle: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  taskDetails: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderRadius: Radius.sm, padding: Spacing.three,
  },
  detailLabel: { fontSize: FontSize.sm },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.five,
    paddingBottom: Platform.OS === 'ios' ? Spacing.seven : Spacing.five,
  },
  modalTitle: {
    fontSize: FontSize.lg, fontWeight: FontWeight.heavy,
    marginBottom: Spacing.five, textAlign: 'center',
  },
  menuButton: {
    flexDirection: 'row', alignItems: 'center',
    padding: Spacing.four, borderRadius: Radius.md,
    marginBottom: Spacing.three, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.three,
  },
  menuButtonText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  modalDivider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.three },
});
