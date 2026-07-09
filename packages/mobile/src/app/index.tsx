import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';
import useAuthStore from '../store/useAuthStore';
import { Ionicons } from '@expo/vector-icons';

const fetchAssignedTasks = async () => {
  const { data } = await apiClient.get('/inventory/cycle-count/my-tasks');
  return data;
};

export default function DashboardScreen() {
  const router = useRouter();
  const { setActiveBatch } = useCycleCountStore();
  const { user, logout } = useAuthStore();

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
    } catch (e) {
      // Ignore network errors to prevent crashes
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load tasks</Text>
        <Text style={styles.errorText}>{error.message}</Text>
      </View>
    );
  }

  const handleTaskPress = (task: any) => {
    const batchData = tasks.filter((t: any) => t.batch_id === task.batch_id);
    setActiveBatch(task.batch_id, batchData, task.line_id);
    router.push('/count');
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.taskCard}
      onPress={() => handleTaskPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.taskHeader}>
        <Ionicons name="clipboard-outline" size={20} color="#3b82f6" />
        <Text style={styles.taskTitle} numberOfLines={1}>{item.display_name}</Text>
      </View>
      <View style={styles.taskDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Part ID:</Text>
          <Text style={styles.detailValue}>{item.part_id}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Batch:</Text>
          <Text style={styles.detailValue}>{item.batch_id}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderHeader = () => {
    const pendingBatches = new Set(tasks?.map((t: any) => t.batch_id)).size || 0;
    return (
      <View style={styles.headerContainer}>
        {/* Welcome Section */}
        <View style={styles.welcomeBanner}>
          <View>
            <Text style={styles.welcomeGreeting}>Hello, {user?.first_name || 'Team Member'} 👋</Text>
            <Text style={styles.welcomeSubtitle}>Forson Auto Parts ERP Gateway</Text>
          </View>
        </View>

        {/* Quick Actions Grid Gateway */}
        <Text style={styles.sectionTitle}>Operational Modules</Text>
        <View style={styles.grid}>
          {/* Row 1 */}
          <View style={styles.gridRow}>
            <TouchableOpacity
              style={[styles.gridCard, { borderLeftColor: '#10B981', borderLeftWidth: 4 }]}
              onPress={() => router.push('/pos')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, { backgroundColor: '#e6f4ea' }]}>
                <Ionicons name="cart" size={24} color="#10B981" />
              </View>
              <Text style={styles.gridTitle}>Point of Sale</Text>
              <Text style={styles.gridSubtitle}>Checkout & Invoices</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.gridCard, { borderLeftColor: '#f59e0b', borderLeftWidth: 4 }]}
              onPress={() => router.push('/unassigned-search')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, { backgroundColor: '#fef3c7' }]}>
                <Ionicons name="barcode" size={24} color="#f59e0b" />
              </View>
              <Text style={styles.gridTitle}>Log Unassigned</Text>
              <Text style={styles.gridSubtitle}>Cycle Count Ad-hoc</Text>
            </TouchableOpacity>
          </View>

          {/* Row 2 */}
          <View style={styles.gridRow}>
            <TouchableOpacity
              style={[styles.gridCard, { borderLeftColor: '#3b82f6', borderLeftWidth: 4 }]}
              onPress={() => router.push('/my-progress')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, { backgroundColor: '#dbeafe' }]}>
                <Ionicons name="analytics" size={24} color="#3b82f6" />
              </View>
              <Text style={styles.gridTitle}>My Progress</Text>
              <Text style={styles.gridSubtitle}>History & Audits</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.gridCard, { borderLeftColor: '#6366f1', borderLeftWidth: 4 }]}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
            >
              <View style={[styles.iconBox, { backgroundColor: '#e0e7ff' }]}>
                <Ionicons name="settings" size={24} color="#6366f1" />
              </View>
              <Text style={styles.gridTitle}>Settings</Text>
              <Text style={styles.gridSubtitle}>Server & Network</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Cycle Count Dashboard Stats */}
        <Text style={styles.sectionTitle}>Inventory Count Summary</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <View style={[styles.statIconBox, { backgroundColor: '#eff6ff' }]}>
              <Ionicons name="list" size={20} color="#2563eb" />
            </View>
            <View>
              <Text style={styles.summaryValue}>{tasks?.length || 0}</Text>
              <Text style={styles.summaryLabel}>Assigned Lines</Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.statIconBox, { backgroundColor: '#fdf2f8' }]}>
              <Ionicons name="layers" size={20} color="#db2777" />
            </View>
            <View>
              <Text style={styles.summaryValue}>{pendingBatches}</Text>
              <Text style={styles.summaryLabel}>Pending Batches</Text>
            </View>
          </View>
        </View>

        {/* Assigned tasks header */}
        <Text style={styles.sectionTitle}>Your Assigned Count Tasks</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Header Navigation */}
      <View style={styles.topHeader}>
        <Text style={styles.topHeaderTitle}>FORSON ERP</Text>
        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => setProfileMenuVisible(true)}
          accessibilityLabel="Profile Menu"
        >
          <Ionicons name="person-circle-outline" size={32} color="#4b5563" />
        </TouchableOpacity>
      </View>

      {/* Main unified Dashboard Feed */}
      <FlatList
        data={tasks || []}
        keyExtractor={(item) => item.line_id.toString()}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>All caught up! No assigned tasks.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#10B981']} />
        }
      />

      {/* User profile / session Modal */}
      <Modal
        visible={isProfileMenuVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setProfileMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setProfileMenuVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>User Account</Text>

            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => {
                setProfileMenuVisible(false);
                router.push('/profile');
              }}
            >
              <Ionicons name="person-outline" size={20} color="#3b82f6" />
              <Text style={styles.menuButtonText}>My Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => {
                setProfileMenuVisible(false);
                router.push('/settings');
              }}
            >
              <Ionicons name="settings-outline" size={20} color="#3b82f6" />
              <Text style={styles.menuButtonText}>Settings</Text>
            </TouchableOpacity>

            <View style={styles.modalDivider} />

            <TouchableOpacity
              style={[styles.menuButton, styles.logoutButton]}
              onPress={async () => {
                setProfileMenuVisible(false);
                await logout();
              }}
            >
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
              <Text style={styles.logoutButtonText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  topHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 1,
  },
  profileBtn: {
    padding: 2,
  },
  headerContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  welcomeBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  welcomeGreeting: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  welcomeSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 10,
  },
  grid: {
    marginBottom: 16,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  gridCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  gridSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  listContainer: {
    paddingBottom: 32,
  },
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  taskDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 20,
    textAlign: 'center',
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  menuButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 10,
  },
  logoutButton: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  logoutButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ef4444',
  },
});
