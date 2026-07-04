import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';

const fetchAssignedTasks = async () => {
  const { data } = await apiClient.get('/inventory/cycle-count/my-tasks');
  return data;
};

export default function DashboardScreen() {
  const router = useRouter();
  const { setActiveBatch } = useCycleCountStore();

  const { data: tasks, isLoading, error, refetch } = useQuery({
    queryKey: ['assignedTasks'],
    queryFn: fetchAssignedTasks,
  });

  const [refreshing, setRefreshing] = useState(false);

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
        <ActivityIndicator size="large" />
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
    // For simplicity, we filter tasks by the clicked task's batch_id
    // to group the active batch data together.
    const batchData = tasks.filter((t: any) => t.batch_id === task.batch_id);
    setActiveBatch(task.batch_id, batchData);
    router.push('/count');
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.taskCard}
      onPress={() => handleTaskPress(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.taskTitle}>{item.display_name}</Text>
      <Text style={styles.taskSubtitle}>Part ID: {item.part_id}</Text>
      <Text style={styles.taskSubtitle}>Batch: {item.batch_id}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard</Text>
      </View>
      <View style={styles.container}>
        <View style={styles.summaryContainer}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{tasks?.length || 0}</Text>
          <Text style={styles.summaryLabel}>Total Items to Count</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>
            {new Set(tasks?.map((t: any) => t.batch_id)).size || 0}
          </Text>
          <Text style={styles.summaryLabel}>Pending Batches</Text>
        </View>
      </View>

      <View style={styles.listTitleRow}>
        <Text style={styles.listTitle}>Assigned Lines</Text>
        <View style={styles.listActions}>
          <TouchableOpacity
            style={styles.progressBtn}
            onPress={() => router.push('/my-progress')}
            activeOpacity={0.8}
          >
            <Text style={styles.progressBtnText}>📊 My Progress</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.adHocBtn}
            onPress={() => router.push('/unassigned-search')}
            activeOpacity={0.8}
          >
            <Text style={styles.adHocBtnText}>+ Log Unassigned</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={tasks || []}
        keyExtractor={(item) => item.line_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={<Text style={styles.emptyText}>No assigned tasks.</Text>}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f3f4f6',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  errorText: {
    color: 'red',
    fontSize: 16,
    marginBottom: 8,
  },
  summaryContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#3b82f6',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  listTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  listActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  progressBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  progressBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  adHocBtn: {
    backgroundColor: '#f59e0b',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  adHocBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  listContainer: {
    paddingBottom: 20,
  },
  taskCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  taskSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  emptyText: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: 20,
  },
});
