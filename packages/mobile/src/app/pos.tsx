import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  useColorScheme,
  TextInput,
  useWindowDimensions,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';
import usePosStore from '../store/usePosStore';
import SearchBar from '@/components/pos/SearchBar';
import ProductListItem from '@/components/pos/ProductListItem';
import CartItem from '@/components/pos/CartItem';
import PriceOverrideSheet from '@/components/pos/PriceOverrideSheet';
import SavedCartsSheet from '@/components/pos/SavedCartsSheet';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';
import { usePermission } from '@/hooks/usePermission';

export default function POSScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const { hasPermission } = usePermission();

  useEffect(() => {
    if (!hasPermission('pos:use')) {
      Alert.alert('Access Denied', 'You do not have permission to use the Point of Sale.');
      router.back();
    }
  }, []);

  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const collapsedHeight = 60 + insets.bottom;
  const normalHeight = windowHeight * 0.45 + insets.bottom;
  const expandedHeight = windowHeight - 120;

  const cartHeight = useSharedValue(normalHeight);
  const isInitialized = useRef(false);
  const [isSavedCartsOpen, setIsSavedCartsOpen] = useState(false);

  useEffect(() => {
    usePosStore.getState().hydrateSavedCarts();
  }, []);

  useEffect(() => {
    if (!isInitialized.current && normalHeight > 0) {
      cartHeight.value = normalHeight;
      isInitialized.current = true;
    }
  }, [normalHeight]);

  const lastCartHeightBeforeKeyboard = useRef(normalHeight);
  const isKeyboardVisible = useRef(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        isKeyboardVisible.current = true;
        lastCartHeightBeforeKeyboard.current = cartHeight.value;
        cartHeight.value = withSpring(collapsedHeight, {
          damping: 20,
          stiffness: 150,
          mass: 0.8,
        });
      }
    );

    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        isKeyboardVisible.current = false;
        cartHeight.value = withSpring(lastCartHeightBeforeKeyboard.current, {
          damping: 20,
          stiffness: 150,
          mass: 0.8,
        });
      }
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [collapsedHeight, normalHeight]);

  const startHeight = useSharedValue(0);

  const gesture = Gesture.Pan()
    .onStart(() => {
      startHeight.value = cartHeight.value;
    })
    .onUpdate((event: any) => {
      let newHeight = startHeight.value - event.translationY;
      if (newHeight < collapsedHeight) {
        newHeight = collapsedHeight;
      } else if (newHeight > expandedHeight) {
        newHeight = expandedHeight;
      }
      cartHeight.value = newHeight;
    })
    .onEnd((event: any) => {
      const currentVal = cartHeight.value;
      const velocityY = event.velocityY;
      let target = normalHeight;

      const snapPoints = [collapsedHeight, normalHeight, expandedHeight];

      if (velocityY < -500) {
        target = currentVal < normalHeight ? normalHeight : expandedHeight;
      } else if (velocityY > 500) {
        target = currentVal > normalHeight ? normalHeight : collapsedHeight;
      } else {
        let minDiff = Infinity;
        for (const pt of snapPoints) {
          const diff = Math.abs(currentVal - pt);
          if (diff < minDiff) {
            minDiff = diff;
            target = pt;
          }
        }
      }

      cartHeight.value = withSpring(target, {
        damping: 20,
        stiffness: 150,
        mass: 0.8,
      });
    });

  const animCartStyle = useAnimatedStyle(() => ({
    height: cartHeight.value,
  }));

  // ── Search state ───────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  // ── Cart store ─────────────────────────────────────────────────────────────
  const cart = usePosStore((s: any) => s.cart);
  const grandTotal = usePosStore((s: any) => s.grandTotal);
  const isPriceOverrideOpen = usePosStore((s: any) => s.isPriceOverrideOpen);
  const overrideItem = usePosStore((s: any) => s.overrideItem);
  const savedCarts = usePosStore((s: any) => s.savedCarts);

  // ── Snackbar (undo remove) ─────────────────────────────────────────────────
  const [snackbar, setSnackbar] = useState<{ visible: boolean; item: any | null }>({ visible: false, item: null });
  const snackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndoSnackbar = useCallback((item: any) => {
    if (snackTimerRef.current) clearTimeout(snackTimerRef.current);
    setSnackbar({ visible: true, item });
    snackTimerRef.current = setTimeout(() => setSnackbar({ visible: false, item: null }), 3000);
  }, []);

  const handleUndo = useCallback(() => {
    if (!snackbar.item) return;
    if (snackTimerRef.current) clearTimeout(snackTimerRef.current);
    usePosStore.getState().addToCart({ ...snackbar.item, _forceQty: snackbar.item.quantity });
    setSnackbar({ visible: false, item: null });
  }, [snackbar.item]);

  // ── Search logic ───────────────────────────────────────────────────────────
  const doSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) { setResults([]); return; }
    setIsSearching(true);
    try {
      const { data } = await apiClient.get('/power-search/parts', { params: { keyword } });
      setResults(data || []);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 300);
  }, [doSearch]);

  const handleScanResult = useCallback(async (barcode: string) => {
    try {
      const { data } = await apiClient.get(`/parts/barcode/${barcode}`);
      if (data) {
        haptics.success();
        usePosStore.getState().addToCart(data);
        setQuery('');
        setResults([]);
        return;
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error('Barcode lookup error:', err);
      }
    }

    setQuery(barcode);
    doSearch(barcode);
  }, [doSearch]);

  // ── Cart actions ───────────────────────────────────────────────────────────
  const handleAddToCart = useCallback((product: any) => {
    haptics.success();
    usePosStore.getState().addToCart(product);
  }, []);

  const handleRemove = useCallback((partId: number) => {
    const item = usePosStore.getState().cart.find((i: any) => i.part_id === partId);
    usePosStore.getState().removeFromCart(partId);
    if (item) showUndoSnackbar(item);
  }, [showUndoSnackbar]);

  const handleQtyChange = useCallback((partId: number, qty: number) => {
    if (qty < 1) {
      const item = usePosStore.getState().cart.find((i: any) => i.part_id === partId);
      usePosStore.getState().removeFromCart(partId);
      if (item) showUndoSnackbar(item);
    } else {
      usePosStore.getState().updateQuantity(partId, qty);
    }
  }, [showUndoSnackbar]);

  const handleLongPress = useCallback((item: any) => {
    Alert.alert(
      item.display_name || item.detail,
      [
        item.part_numbers ? `SKU: ${item.part_numbers}` : null,
        item.brand_name ? `Brand: ${item.brand_name}` : null,
        `Stock: ${item.stock_qty ?? item.stock_on_hand ?? 'N/A'}`,
        `Unit Price: ${formatPHP(item.sale_price)}`,
      ].filter(Boolean).join('\n'),
    );
  }, []);

  const handleOpenSavedCarts = useCallback(() => {
    haptics.tap?.();
    if (isKeyboardVisible.current) {
      Keyboard.dismiss();
      setTimeout(() => {
        setIsSavedCartsOpen(true);
      }, 150);
    } else {
      setIsSavedCartsOpen(true);
    }
  }, []);

  const handleNewCart = useCallback(() => {
    haptics.tap?.();
    if (cart.length > 0) {
      usePosStore.getState().saveCurrentCart('');
      haptics.success?.();
    } else {
      usePosStore.getState().clearCart();
    }
  }, [cart.length]);

  const activeSavedCartId = usePosStore((s: any) => s.activeSavedCartId);
  const isSavedCartActive = activeSavedCartId !== null;
  const activeSavedCart = savedCarts.find((c: any) => c.id === activeSavedCartId);

  const bg = isDark ? '#111827' : '#f9fafb';
  const cartBg = isSavedCartActive
    ? (isDark ? '#022c22' : '#f0fdf4') // Emerald/green tint
    : (isDark ? '#1f2937' : '#fff');

  const cartBorderColor = isSavedCartActive
    ? '#10B981'
    : (isDark ? '#374151' : '#e5e7eb');

  const cartBorderWidth = isSavedCartActive ? 2.5 : 1;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {/* App bar */}
          <View style={styles.appBar}>
            <Text style={styles.appBarTitle}>Point of Sale</Text>
            {cart.length > 0 && (
              <TouchableOpacity
                onPress={() => { haptics.error(); usePosStore.getState().clearCart(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={22} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>

          {/* Top 15%: Search */}
          <View style={[styles.topArea, { zIndex: 10, elevation: 8 }]}>
            <SearchBar
              value={query}
              onChangeText={handleQueryChange}
              onScanResult={handleScanResult}
              searchInputRef={searchInputRef as any}
            />
          </View>

          {/* Middle 40%: Results */}
          {/* TODO: Evaluate @shopify/flash-list for 10k+ row performance vs FlatList */}
          <View style={[styles.middleArea, { backgroundColor: bg }]}>
            <FlatList
              data={results}
              keyExtractor={(item) => String(item.part_id)}
              renderItem={({ item }) => (
                <ProductListItem item={item} onPress={handleAddToCart} />
              )}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.emptyResults}>
                  <Text style={[styles.emptyText, isDark && styles.emptyTextDark]}>
                    {isSearching ? 'Searching...' : query.trim() ? `No results for "${query}"` : 'Search or scan a barcode to add items'}
                  </Text>
                </View>
              }
            />
          </View>

          {/* Bottom 45%: Cart */}
          <Animated.View style={[
            styles.bottomArea,
            animCartStyle,
            { 
              backgroundColor: cartBg, 
              borderTopColor: cartBorderColor, 
              borderTopWidth: cartBorderWidth,
              overflow: 'hidden' 
            }
          ]}>
            <GestureDetector gesture={gesture}>
              <View style={styles.dragHandleContainer}>
                <View style={[styles.dragHandle, isDark && styles.dragHandleDark]} />
                  <View style={styles.cartHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        style={[
                          styles.cartPill,
                          isDark && styles.cartPillDark,
                          isSavedCartActive && {
                            borderColor: '#10B981',
                            borderWidth: 1.5,
                            backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.08)',
                          }
                        ]}
                        onPress={handleOpenSavedCarts}
                      >
                        <Ionicons 
                          name="cart" 
                          size={16} 
                          color={isSavedCartActive ? '#10B981' : (isDark ? '#9ca3af' : '#4b5563')} 
                          style={{ marginRight: 2 }} 
                        />
                        <Text style={[styles.cartPillText, isDark && styles.cartPillTextDark]}>
                          {cart.length > 0 ? `${cart.length}` : '0'}
                          {isSavedCartActive && activeSavedCart ? ` · ${activeSavedCart.name}` : ''}
                        </Text>
                        <Ionicons name="chevron-down" size={13} color={isDark ? '#9ca3af' : '#4b5563'} style={{ marginLeft: 3 }} />
                        {savedCarts.length > 0 && (
                          <View style={styles.pillBadge}>
                            <Text style={styles.pillBadgeText}>{savedCarts.length}</Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.cartPill,
                          isDark && styles.cartPillDark,
                          { paddingHorizontal: 10 },
                          cart.length === 0 && { opacity: 0.4 }
                        ]}
                        disabled={cart.length === 0}
                        onPress={handleNewCart}
                        activeOpacity={0.72}
                      >
                        <Ionicons name="add" size={18} color={isDark ? '#9ca3af' : '#4b5563'} />
                      </TouchableOpacity>
                    </View>
                    <Text style={[styles.cartTotal, isDark && styles.cartTotalDark]}>
                      {formatPHP(grandTotal)}
                    </Text>
                  </View>
              </View>
            </GestureDetector>

            <FlatList
              data={cart}
              keyExtractor={(item: any) => String(item.part_id)}
              renderItem={({ item }: any) => (
                <CartItem
                  item={item}
                  onRemove={handleRemove}
                  onQuantityChange={handleQtyChange}
                  onPriceOverride={(i) => { haptics.tap(); usePosStore.getState().openPriceOverride(i); }}
                  onLongPress={handleLongPress}
                />
              )}
              overScrollMode="never"
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.emptyCart}>
                  <Ionicons name="cart-outline" size={36} color={isDark ? '#4b5563' : '#d1d5db'} />
                  <Text style={[styles.emptyCartText, isDark && styles.emptyTextDark]}>Cart is empty</Text>
                </View>
              }
            />

            <View style={[
              styles.chargeBar,
              {
                borderTopColor: isDark ? '#374151' : '#f3f4f6',
                paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 12,
              }
            ]}>
              <TouchableOpacity
                style={[styles.chargeBtn, cart.length === 0 && styles.chargeBtnDisabled]}
                disabled={cart.length === 0}
                onPress={() => { haptics.tap(); router.push('/pos-settlement'); }}
              >
                <Ionicons name="card-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.chargeBtnText}>
                  Charge {cart.length > 0 ? formatPHP(grandTotal) : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>

        {/* Price override sheet */}
        <PriceOverrideSheet
          visible={isPriceOverrideOpen}
          item={overrideItem}
          onClose={() => usePosStore.getState().closePriceOverride()}
          onConfirm={(partId, price) => { usePosStore.getState().updatePrice(partId, price); haptics.success(); }}
        />

        <SavedCartsSheet
          visible={isSavedCartsOpen}
          onClose={() => setIsSavedCartsOpen(false)}
        />

        {/* Undo snackbar */}
        {snackbar.visible && (
          <View style={[styles.snackbar, { bottom: 100 + insets.bottom }]}>
            <Text style={styles.snackText}>Item removed.</Text>
            <TouchableOpacity onPress={handleUndo}>
              <Text style={styles.snackUndo}>UNDO</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  appBarTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  topArea: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  middleArea: { flex: 1 },
  bottomArea: { borderTopWidth: 1 },
  dragHandleContainer: {
    paddingTop: 8,
    paddingBottom: 2,
    alignItems: 'stretch',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 4,
  },
  dragHandleDark: {
    backgroundColor: '#4b5563',
  },
  emptyResults: { paddingTop: 24, alignItems: 'center', paddingHorizontal: 24 },
  emptyText: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
  emptyTextDark: { color: '#6b7280' },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  cartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cartPillDark: {
    backgroundColor: '#374151',
  },
  cartPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  cartPillTextDark: {
    color: '#f9fafb',
  },
  pillBadge: {
    marginLeft: 6,
    backgroundColor: '#10B981',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  pillBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  cartTotal: { fontSize: 16, fontWeight: '800', color: '#10B981' },
  cartTotalDark: { color: '#34d399' },
  emptyCart: { alignItems: 'center', paddingTop: 20, gap: 8 },
  emptyCartText: { color: '#9ca3af', fontSize: 14 },
  chargeBar: { padding: 12, borderTopWidth: 1 },
  chargeBtn: {
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  chargeBtnDisabled: { backgroundColor: '#d1d5db', shadowOpacity: 0, elevation: 0 },
  chargeBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  snackbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#111827',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  snackText: { color: '#fff', fontSize: 14 },
  snackUndo: { color: '#10B981', fontWeight: '800', fontSize: 14 },
});
