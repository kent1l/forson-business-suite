import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useCycleCountStore from '../store/useCycleCountStore';
import MobileCounter from '../components/MobileCounter';
import apiClient from '../api/client';

export default function CountScreen() {
  const router = useRouter();
  const { activeBatchData, clearActiveBatch } = useCycleCountStore();
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [collectedCounts, setCollectedCounts] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!activeBatchData || activeBatchData.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>No active batch selected.</Text>
      </View>
    );
  }

  const currentLine = activeBatchData[currentLineIndex];

  const handleSubmitCount = async (countedQty: number) => {
    const newCounts = { ...collectedCounts, [currentLine.line_id.toString()]: countedQty };
    setCollectedCounts(newCounts);

    if (currentLineIndex + 1 < activeBatchData.length) {
      setCurrentLineIndex(prev => prev + 1);
    } else {
      // Reached the end, trigger full payload delivery
      setIsSubmitting(true);
      try {
        // Compile quantities against the backend snapshot commit endpoint
        // Since there is no bulk endpoint, we use Promise.all to submit individually
        const submitPromises = activeBatchData.map((line: any) => {
          const lineIdStr = String(line.line_id);
          return apiClient.post(`/inventory/cycle-count/lines/${line.line_id}/submit`, {
            counted_qty: (newCounts as Record<string, number>)[lineIdStr]
          });
        });

        await Promise.all(submitPromises);

        setIsSubmitting(false);
        Alert.alert('Batch Complete', 'All items submitted successfully.', [
          {
            text: 'OK',
            onPress: () => {
              clearActiveBatch();
              router.replace('/');
            },
          },
        ]);
      } catch (error: any) {
        setIsSubmitting(false);
        console.error('Submit batch error', error);
        Alert.alert('Error', error.response?.data?.message || 'Failed to submit one or more items.');
      }
    }
  };

  if (isSubmitting) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={{ marginTop: 16 }}>Submitting batch...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerZone}>
        <Text style={styles.itemTitle}>{currentLine.display_name}</Text>
        <Text style={styles.itemSubtitle}>Item {currentLineIndex + 1} of {activeBatchData.length}</Text>
        <Text style={styles.itemSubtitle}>Part ID: {currentLine.part_id}</Text>
      </View>
      <View style={styles.counterZone}>
        <MobileCounter
          initialQuantity={0}
          onSubmit={handleSubmitCount}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: 'red',
  },
  headerZone: {
    padding: 20,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  itemSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  counterZone: {
    flex: 1,
    justifyContent: 'center',
  },
});
