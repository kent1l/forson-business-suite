import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useColorScheme } from 'react-native';
import { formatPHP } from '@/utils/currency';
import { Fonts } from '@/constants/theme';

interface Props {
  item: any;
  onPress: (item: any) => void;
}

export default function ProductListItem({ item, onPress }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isOutOfStock = (item.stock_qty ?? 1) <= 0;

  return (
    <TouchableOpacity
      style={[styles.row, isDark && styles.rowDark, isOutOfStock && styles.rowOOS]}
      onPress={() => onPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.left}>
        <Text style={[styles.sku, isDark && styles.skuDark]} numberOfLines={1}>
          {item.part_numbers || item.part_id}
        </Text>
        <Text style={[styles.name, isDark && styles.nameDark]} numberOfLines={2}>
          {item.display_name || item.detail}
        </Text>
        {item.brand_name ? (
          <Text style={[styles.brand, isDark && styles.brandDark]} numberOfLines={1}>
            {item.brand_name}
          </Text>
        ) : null}
        {isOutOfStock && (
          <Text style={styles.oos}>Out of Stock</Text>
        )}
      </View>
      <View style={styles.right}>
        <Text style={[styles.price, isDark && styles.priceDark]}>
          {formatPHP(item.last_sale_price ?? 0)}
        </Text>
        {!isOutOfStock && (
          <Text style={[styles.stock, isDark && styles.stockDark]}>
            {item.stock_qty ?? 0} in stock
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowDark: {
    backgroundColor: '#1f2937',
    borderBottomColor: '#374151',
  },
  rowOOS: {
    opacity: 0.6,
  },
  left: {
    flex: 1,
    marginRight: 12,
  },
  sku: {
    fontFamily: Fonts?.default?.mono ?? 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  skuDark: {
    color: '#f9fafb',
  },
  name: {
    fontSize: 15,
    color: '#374151',
    marginBottom: 2,
  },
  nameDark: {
    color: '#d1d5db',
  },
  brand: {
    fontSize: 12,
    color: '#6b7280',
  },
  brandDark: {
    color: '#9ca3af',
  },
  oos: {
    fontSize: 11,
    color: '#ef4444',
    fontWeight: '600',
    marginTop: 2,
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 90,
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  priceDark: {
    color: '#f9fafb',
  },
  stock: {
    fontSize: 11,
    color: '#10B981',
    marginTop: 2,
  },
  stockDark: {
    color: '#34d399',
  },
});
