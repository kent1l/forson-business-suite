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
  FlatList,
  Alert,
  Keyboard,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import usePosStore from '@/store/usePosStore';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SavedCartsSheet({ visible, onClose }: Props) {
  const isDark = useColorScheme() === 'dark';
  const [nameText, setNameText] = useState('');
  
  const cart = usePosStore((s: any) => s.cart);
  const savedCarts = usePosStore((s: any) => s.savedCarts);
  
  const translateY = useSharedValue(500);

  useEffect(() => {
    if (visible) {
      setNameText('');
      translateY.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    } else {
      translateY.value = withTiming(500, { duration: 240, easing: Easing.in(Easing.cubic) });
    }
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const handleSave = () => {
    if (cart.length === 0) {
      haptics.error?.();
      Alert.alert('Empty Cart', 'There are no items in the cart to save.');
      return;
    }
    const name = nameText.trim();
    haptics.success?.();
    usePosStore.getState().saveCurrentCart(name);
    setNameText('');
    Keyboard.dismiss();
    onClose();
  };

  const handleLoad = (id: string, name: string) => {
    if (cart.length > 0) {
      Alert.alert(
        'Overwrite Cart?',
        'Loading this saved cart will replace all items in your current cart. Proceed?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Proceed',
            style: 'destructive',
            onPress: () => {
              haptics.success?.();
              usePosStore.getState().loadSavedCart(id);
              onClose();
            },
          },
        ]
      );
    } else {
      haptics.success?.();
      usePosStore.getState().loadSavedCart(id);
      onClose();
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert(
      'Delete Cart?',
      'Are you sure you want to delete this saved cart?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptics.success?.();
            usePosStore.getState().deleteSavedCart(id);
          },
        },
      ]
    );
  };

  const formatSavedTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const bg = isDark ? '#111827' : '#fff';
  const text = isDark ? '#f9fafb' : '#111827';
  const border = isDark ? '#374151' : '#e5e7eb';
  const inputBg = isDark ? '#1f2937' : '#f3f4f6';

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <Animated.View style={[styles.sheet, { backgroundColor: bg }, animStyle]}>
          <View style={styles.handle} />
          
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: text }]}>Saved Carts</Text>
            <TouchableOpacity onPress={() => { haptics.tap?.(); onClose(); }}>
              <Ionicons name="close-circle" size={24} color={isDark ? '#9ca3af' : '#4b5563'} />
            </TouchableOpacity>
          </View>

          {cart.length > 0 && (
            <View style={styles.saveSection}>
              <Text style={[styles.sectionTitle, { color: text }]}>Save Active Cart</Text>
              <View style={styles.saveInputRow}>
                <TextInput
                  style={[styles.input, { backgroundColor: inputBg, color: text, borderColor: border }]}
                  placeholder="Enter reference/customer name..."
                  placeholderTextColor={isDark ? '#6b7280' : '#9ca3af'}
                  value={nameText}
                  onChangeText={setNameText}
                  maxLength={40}
                />
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: text, marginTop: cart.length > 0 ? 16 : 8 }]}>
            Saved Queue ({savedCarts.length})
          </Text>

          <FlatList
            data={savedCarts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="archive-outline" size={40} color={isDark ? '#4b5563' : '#d1d5db'} />
                <Text style={styles.emptyText}>No saved carts</Text>
                <Text style={styles.emptySubText}>Save current cart to hold it for later</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.cartItem, { borderColor: border }]}>
                <View style={styles.cartInfo}>
                  <Text style={[styles.cartName, { color: text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.cartMeta}>
                    {item.items.reduce((sum: number, i: any) => sum + i.quantity, 0)} items • {formatSavedTime(item.savedAt)}
                  </Text>
                </View>
                <View style={styles.cartActions}>
                  <Text style={styles.cartTotal}>{formatPHP(item.total)}</Text>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleLoad(item.id, item.name)}>
                    <Ionicons name="arrow-redo-outline" size={18} color="#10B981" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]} 
                    onPress={() => handleDelete(item.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
    minHeight: '40%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  saveSection: {
    marginBottom: 16,
  },
  saveInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
  },
  saveBtn: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  listContainer: {
    paddingBottom: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9ca3af',
  },
  emptySubText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  cartItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  cartInfo: {
    flex: 1,
    marginRight: 12,
  },
  cartName: {
    fontSize: 15,
    fontWeight: '700',
  },
  cartMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  cartActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cartTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#10B981',
    marginRight: 4,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
