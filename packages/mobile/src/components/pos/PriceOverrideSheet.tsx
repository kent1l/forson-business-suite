import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

interface Props {
  visible: boolean;
  item: any;
  onClose: () => void;
  onConfirm: (partId: number, newPrice: number) => void;
}

export default function PriceOverrideSheet({ visible, item, onClose, onConfirm }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [priceText, setPriceText] = useState('');
  const translateY = useSharedValue(400);

  useEffect(() => {
    if (visible) {
      setPriceText(item ? String(item.sale_price ?? '') : '');
      translateY.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    } else {
      translateY.value = withTiming(400, { duration: 240, easing: Easing.in(Easing.cubic) });
    }
  }, [visible, item]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleConfirm = () => {
    const parsed = parseFloat(priceText);
    if (isNaN(parsed) || parsed < 0) {
      haptics.error();
      return;
    }
    haptics.success();
    onConfirm(item.part_id, parsed);
    onClose();
  };

  if (!visible && !item) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <Animated.View style={[styles.sheet, isDark && styles.sheetDark, animStyle]}>
          <View style={styles.handle} />
          <Text style={[styles.title, isDark && styles.titleDark]}>Price Override</Text>
          {item && (
            <Text style={[styles.itemName, isDark && styles.itemNameDark]} numberOfLines={2}>
              {item.display_name || item.detail}
            </Text>
          )}
          <Text style={[styles.currentLabel, isDark && styles.currentLabelDark]}>
            Current: {item ? formatPHP(item.sale_price) : '—'}
          </Text>

          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="decimal-pad"
            placeholder="Enter new price"
            placeholderTextColor="#9ca3af"
            autoFocus
            selectTextOnFocus
          />

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn]}
              onPress={() => { haptics.tap(); onClose(); }}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn]}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  sheetDark: {
    backgroundColor: '#1f2937',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  titleDark: {
    color: '#f9fafb',
  },
  itemName: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  itemNameDark: {
    color: '#d1d5db',
  },
  currentLabel: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  currentLabelDark: {
    color: '#9ca3af',
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
    textAlign: 'center',
  },
  inputDark: {
    borderColor: '#34d399',
    color: '#f9fafb',
    backgroundColor: '#374151',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#f3f4f6',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  confirmBtn: {
    backgroundColor: '#10B981',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
