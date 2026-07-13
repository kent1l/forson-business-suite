import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

interface CartItemData {
  part_id: number;
  detail: string;
  display_name?: string;
  sale_price: number;
  quantity: number;
}

interface Props {
  item: CartItemData;
  onRemove: (partId: number) => void;
  onQuantityChange: (partId: number, qty: number) => void;
  onPriceOverride: (item: CartItemData) => void;
  onLongPress: (item: CartItemData) => void;
}

export default function CartItem({ item, onRemove, onQuantityChange, onPriceOverride, onLongPress }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const swipeRef = useRef<Swipeable>(null);

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.swipeRight}
      onPress={() => {
        haptics.tap();
        swipeRef.current?.close();
        onPriceOverride(item);
      }}
    >
      <Ionicons name="pencil" size={20} color="#fff" />
      <Text style={styles.swipeText}>Override</Text>
    </TouchableOpacity>
  );

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.swipeLeft}
      onPress={() => {
        haptics.error();
        swipeRef.current?.close();
        onRemove(item.part_id);
      }}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeText}>Remove</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      friction={2}
      overshootFriction={8}
    >
      <TouchableOpacity
        style={[styles.row, isDark && styles.rowDark]}
        delayLongPress={500}
        onLongPress={() => { haptics.tap(); onLongPress(item); }}
        activeOpacity={1}
      >
        {/* Item info */}
        <View style={styles.info}>
          <Text style={[styles.name, isDark && styles.nameDark]} numberOfLines={2}>
            {item.display_name || item.detail}
          </Text>
          {/* Tappable price with dashed border to signal editability */}
          <TouchableOpacity onPress={() => { haptics.tap(); onPriceOverride(item); }}>
            <Text style={[styles.unitPrice, isDark && styles.unitPriceDark]}>
              {formatPHP(item.sale_price)} / ea
            </Text>
          </TouchableOpacity>
        </View>

        {/* Qty stepper */}
        <View style={styles.stepper}>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => { haptics.tap(); onQuantityChange(item.part_id, item.quantity - 1); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="remove" size={18} color={isDark ? '#f9fafb' : '#111827'} />
          </TouchableOpacity>
          <Text style={[styles.qty, isDark && styles.qtyDark]}>{item.quantity}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => { haptics.tap(); onQuantityChange(item.part_id, item.quantity + 1); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="add" size={18} color={isDark ? '#f9fafb' : '#111827'} />
          </TouchableOpacity>
        </View>

        {/* Line total */}
        <Text style={[styles.lineTotal, isDark && styles.lineTotalDark]}>
          {formatPHP(item.sale_price * item.quantity)}
        </Text>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowDark: {
    backgroundColor: '#1f2937',
    borderBottomColor: '#374151',
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 3,
  },
  nameDark: {
    color: '#f9fafb',
  },
  unitPrice: {
    fontSize: 12,
    color: '#6b7280',
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: '#9ca3af',
    alignSelf: 'flex-start',
    paddingBottom: 1,
  },
  unitPriceDark: {
    color: '#9ca3af',
    borderBottomColor: '#6b7280',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  stepBtn: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qty: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    minWidth: 28,
    textAlign: 'center',
  },
  qtyDark: {
    color: '#f9fafb',
  },
  lineTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    minWidth: 80,
    textAlign: 'right',
  },
  lineTotalDark: {
    color: '#f9fafb',
  },
  swipeLeft: {
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  swipeRight: {
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  swipeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
