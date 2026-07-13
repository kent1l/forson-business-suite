import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import usePosStore from '@/store/usePosStore';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ── Animation constants ───────────────────────────────────────────────────────
const SPRING_OPEN  = { damping: 22, stiffness: 220, mass: 0.9 };
const TIMING_CLOSE = { duration: 260, easing: Easing.in(Easing.cubic) };

export default function SavedCartsSheet({ visible, onClose }: Props) {
  const isDark    = useColorScheme() === 'dark';
  const [nameText, setNameText] = useState('');
  // keep the Modal mounted through the exit animation
  const [mounted, setMounted] = useState(visible);

  const cart       = usePosStore((s: any) => s.cart);
  const savedCarts = usePosStore((s: any) => s.savedCarts);

  const progress = useSharedValue(0); // 0 = closed, 1 = open
  const inputRef = useRef<TextInput>(null);

  // ── Mount / unmount with animation ────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setMounted(true);
      setNameText('');
    }
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      progress.value = withSpring(1, SPRING_OPEN);
    } else {
      progress.value = withTiming(0, TIMING_CLOSE, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [visible, mounted]);

  // ── Animated styles ───────────────────────────────────────────────────────
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{
      translateY: interpolate(progress.value, [0, 1], [480, 0]),
    }],
  }));

  // ── Actions ───────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleSave = useCallback(() => {
    if (cart.length === 0) {
      haptics.error?.();
      Alert.alert('Empty Cart', 'There are no items in the cart to save.');
      return;
    }
    haptics.success?.();
    usePosStore.getState().saveCurrentCart(nameText.trim());
    close();
  }, [cart.length, nameText, close]);

  const handleLoad = useCallback((id: string) => {
    if (cart.length > 0) {
      Alert.alert(
        'Load Saved Cart',
        'This will replace your current cart items. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Load Cart',
            onPress: () => {
              haptics.success?.();
              usePosStore.getState().loadSavedCart(id);
              close();
            },
          },
        ],
      );
    } else {
      haptics.success?.();
      usePosStore.getState().loadSavedCart(id);
      close();
    }
  }, [cart.length, close]);

  const handleDelete = useCallback((id: string, name: string) => {
    haptics.error?.();
    Alert.alert(
      'Delete Cart',
      `Remove "${name}" from the queue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => usePosStore.getState().deleteSavedCart(id),
        },
      ],
    );
  }, []);

  const formatSavedTime = (isoString: string) => {
    try {
      const now     = new Date();
      const date    = new Date(isoString);
      const diffMs  = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1)  return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24)  return `${diffHr}h ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const bg       = isDark ? '#111827' : '#fff';
  const surface  = isDark ? '#1f2937' : '#f8fafc';
  const text     = isDark ? '#f9fafb' : '#111827';
  const subtext  = isDark ? '#9ca3af' : '#6b7280';
  const border   = isDark ? '#374151' : '#e5e7eb';
  const handleBg = isDark ? '#4b5563' : '#d1d5db';

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent statusBarTranslucent animationType="none" onRequestClose={close}>
      {/* Animated backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      {/* Sheet wrapper — sits at bottom with keyboard-avoidance */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={styles.anchor} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { backgroundColor: bg }, sheetStyle]}>

            {/* Drag handle */}
            <View style={[styles.handle, { backgroundColor: handleBg }]} />

            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <Ionicons name="layers-outline" size={20} color="#10B981" style={{ marginRight: 8 }} />
                <Text style={[styles.title, { color: text }]}>Cart Queue</Text>
                {savedCarts.length > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{savedCarts.length}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: surface }]}
                onPress={() => { haptics.tap?.(); close(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color={subtext} />
              </TouchableOpacity>
            </View>

            {/* Save section — only when active cart has items */}
            {cart.length > 0 && (
              <View style={[styles.saveCard, { backgroundColor: surface, borderColor: border }]}>
                <View style={styles.saveCardHeader}>
                  <Ionicons name="bookmark-outline" size={15} color="#10B981" />
                  <Text style={[styles.saveCardTitle, { color: text }]}>Hold Current Cart</Text>
                  <Text style={[styles.saveCardCount, { color: subtext }]}>
                    {cart.length} {cart.length === 1 ? 'item' : 'items'}
                  </Text>
                </View>
                <View style={styles.saveInputRow}>
                  <TextInput
                    ref={inputRef}
                    style={[styles.input, { backgroundColor: isDark ? '#0f172a' : '#fff', color: text, borderColor: border }]}
                    placeholder="Customer or reference name..."
                    placeholderTextColor={subtext}
                    value={nameText}
                    onChangeText={setNameText}
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                  />
                  <TouchableOpacity
                    style={[styles.saveBtn, nameText.trim().length === 0 && styles.saveBtnMuted]}
                    onPress={handleSave}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="bookmark" size={15} color="#fff" />
                    <Text style={styles.saveBtnText}>Hold</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Queue label */}
            <View style={styles.queueHeader}>
              <Text style={[styles.sectionLabel, { color: subtext }]}>
                QUEUE{savedCarts.length > 0 ? ` · ${savedCarts.length}` : ''}
              </Text>
            </View>

            <FlatList
              data={savedCarts}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <View style={[styles.emptyIcon, { backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }]}>
                    <Ionicons name="layers-outline" size={30} color={isDark ? '#374151' : '#d1d5db'} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: subtext }]}>No held carts</Text>
                  {cart.length > 0 && (
                    <Text style={[styles.emptyHint, { color: isDark ? '#4b5563' : '#9ca3af' }]}>
                      Hold your active cart above to serve another customer
                    </Text>
                  )}
                </View>
              }
              renderItem={({ item, index }) => (
                <CartQueueRow
                  item={item}
                  index={index}
                  isDark={isDark}
                  text={text}
                  subtext={subtext}
                  border={border}
                  onLoad={() => handleLoad(item.id)}
                  onDelete={() => handleDelete(item.id, item.name)}
                  formatTime={formatSavedTime}
                />
              )}
            />

          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Extracted row component (isolated animation state) ────────────────────────
function CartQueueRow({
  item, index, isDark, text, subtext, border,
  onLoad, onDelete, formatTime,
}: any) {
  const scale   = useSharedValue(0.92);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => {
      scale.value   = withSpring(1, { damping: 18, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
    }, index * 45);
    return () => clearTimeout(t);
  }, []);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const totalItems = item.items.reduce((s: number, i: any) => s + i.quantity, 0);

  return (
    <Animated.View style={[styles.cartRow, { borderBottomColor: border }, rowStyle]}>
      <TouchableOpacity style={styles.cartRowMain} onPress={onLoad} activeOpacity={0.72}>
        <View style={styles.cartRowIcon}>
          <Ionicons name="cart-outline" size={17} color="#10B981" />
        </View>
        <View style={styles.cartRowInfo}>
          <Text style={[styles.cartRowName, { color: text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.cartRowMeta, { color: subtext }]}>
            {totalItems} {totalItems === 1 ? 'item' : 'items'} · {formatTime(item.savedAt)}
          </Text>
        </View>
        <Text style={styles.cartRowTotal}>{formatPHP(item.total)}</Text>
        <Ionicons name="chevron-forward" size={14} color={isDark ? '#4b5563' : '#d1d5db'} style={{ marginLeft: 2 }} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.cartRowDeleteBtn, { backgroundColor: isDark ? '#1f2937' : '#fff5f5' }]}
        onPress={onDelete}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="trash-outline" size={15} color="#ef4444" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },

  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  anchor: {
    width: '100%',
  },

  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    maxHeight: '82%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 20,
  },

  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  badge: {
    marginLeft: 8,
    backgroundColor: '#10B981',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Save card ──────────────────────────────────────────────────────────────
  saveCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
  },
  saveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  saveCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  saveCardCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  saveInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 14,
    borderWidth: 1,
  },
  saveBtn: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  saveBtnMuted: {
    backgroundColor: '#6ee7b7',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Queue header ───────────────────────────────────────────────────────────
  queueHeader: {
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  // ── FlatList ──────────────────────────────────────────────────────────────
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 8,
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 10,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyHint: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 24,
  },

  // ── Cart row ──────────────────────────────────────────────────────────────
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    gap: 6,
  },
  cartRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  cartRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartRowInfo: {
    flex: 1,
  },
  cartRowName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  cartRowMeta: {
    fontSize: 12,
  },
  cartRowTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#10B981',
  },
  cartRowDeleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
