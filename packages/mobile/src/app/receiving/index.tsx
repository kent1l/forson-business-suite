import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import apiClient from '../../api/client';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import StatusBadge, { toneForStatus } from '../../components/ui/StatusBadge';
import { LoadingState, EmptyState, ErrorState } from '../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';

type PurchaseOrder = {
  po_id: number;
  po_number: string;
  supplier_name: string;
  order_date: string;
  status: string;
  total_amount: string | null;
};

/** Open purchase orders waiting to be received. */
export default function ReceivingListScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery<PurchaseOrder[]>({
    queryKey: ['openPurchaseOrders'],
    queryFn: async () => (await apiClient.get('/purchase-orders/open')).data,
  });

  const renderItem = ({ item }: { item: PurchaseOrder }) => (
    <Card onPress={() => router.push(`/receiving/${item.po_id}` as never)}>
      <View style={styles.rowBetween}>
        <Text style={[styles.poNumber, { color: theme.text }]} numberOfLines={1}>
          {item.po_number || `PO ${item.po_id}`}
        </Text>
        <StatusBadge label={item.status} tone={toneForStatus(item.status)} />
      </View>
      <Text style={[styles.supplier, { color: theme.textSecondary }]} numberOfLines={1}>
        {item.supplier_name}
      </Text>
      <Text style={[styles.meta, { color: theme.textMuted }]}>
        Ordered {new Date(item.order_date).toLocaleDateString('en-PH')}
      </Text>
    </Card>
  );

  return (
    <Screen>
      <AppHeader title="Receiving" subtitle={data ? `${data.length} open` : undefined} />
      {isLoading ? (
        <LoadingState label="Loading purchase orders…" />
      ) : error ? (
        <ErrorState
          title="Could not load purchase orders"
          description="Receiving needs a connection to the server."
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.po_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="Nothing to receive"
              description="There are no open purchase orders right now."
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  poNumber: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.bold },
  supplier: { fontSize: FontSize.sm, marginTop: Spacing.one },
  meta: { fontSize: FontSize.xs, marginTop: 1 },
});
