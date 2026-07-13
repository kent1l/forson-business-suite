import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import apiClient from '../api/client';

const usePosStore = create((set, get) => ({
  // ── Cart state ────────────────────────────────────────────────────────────
  cart: [],
  grandTotal: 0,
  savedCarts: [],
  activeSavedCartId: null,

  // ── UI state ──────────────────────────────────────────────────────────────
  isPriceOverrideOpen: false,
  overrideItem: null,
  isSettlementOpen: false,

  // ── Cart actions ──────────────────────────────────────────────────────────
  addToCart: (product) => {
    set((state) => {
      const existing = state.cart.find((i) => i.part_id === product.part_id);
      const qtyToAdd = product._forceQty || 1;
      if (existing) {
        const cart = state.cart.map((i) =>
          i.part_id === product.part_id
            ? { ...i, quantity: i.quantity + qtyToAdd }
            : i,
        );
        return {
          cart,
          grandTotal: _calcTotal(cart),
          savedCarts: _syncSavedCarts(state.savedCarts, state.activeSavedCartId, cart),
        };
      }
      const isSparkPlug = /spark\s*plug/i.test(
        `${product.name || ''} ${product.detail || ''} ${product.display_name || ''}`,
      );
      const initialQty = product._forceQty !== undefined ? product._forceQty : (isSparkPlug ? 4 : 1);
      const item = {
        part_id: product.part_id,
        detail: product.detail,
        display_name: product.display_name,
        part_numbers: product.part_numbers,
        brand_name: product.brand_name,
        sale_price: parseFloat(product.last_sale_price ?? product.sale_price ?? 0),
        quantity: initialQty,
        stock_qty: product.stock_qty ?? product.stock_on_hand ?? 0,
        is_tax_inclusive_price: product.is_tax_inclusive_price,
      };
      const cart = [...state.cart, item];
      return {
        cart,
        grandTotal: _calcTotal(cart),
        savedCarts: _syncSavedCarts(state.savedCarts, state.activeSavedCartId, cart),
      };
    });
  },

  removeFromCart: (partId) => {
    set((state) => {
      const cart = state.cart.filter((i) => i.part_id !== partId);
      return {
        cart,
        grandTotal: _calcTotal(cart),
        savedCarts: _syncSavedCarts(state.savedCarts, state.activeSavedCartId, cart),
      };
    });
  },

  updateQuantity: (partId, qty) => {
    set((state) => {
      const cart = state.cart.map((i) =>
        i.part_id === partId ? { ...i, quantity: Math.max(1, qty) } : i,
      );
      return {
        cart,
        grandTotal: _calcTotal(cart),
        savedCarts: _syncSavedCarts(state.savedCarts, state.activeSavedCartId, cart),
      };
    });
  },

  updatePrice: (partId, newPrice) => {
    set((state) => {
      const cart = state.cart.map((i) =>
        i.part_id === partId ? { ...i, sale_price: newPrice } : i,
      );
      return {
        cart,
        grandTotal: _calcTotal(cart),
        savedCarts: _syncSavedCarts(state.savedCarts, state.activeSavedCartId, cart),
      };
    });
  },

  clearCart: () => {
    set({ cart: [], grandTotal: 0, activeSavedCartId: null });
  },

  hydrateSavedCarts: async () => {
    try {
      const savedStr = await SecureStore.getItemAsync('pos_saved_carts');
      if (savedStr) {
        set({ savedCarts: JSON.parse(savedStr) });
      }
    } catch (e) {
      console.error('Failed to hydrate saved carts:', e);
    }
  },

  saveCurrentCart: async (name) => {
    const { cart, savedCarts, activeSavedCartId } = get();
    if (cart.length === 0) return;

    let updated;
    if (activeSavedCartId) {
      // Update existing held cart
      updated = savedCarts.map(c => {
        if (c.id === activeSavedCartId) {
          return {
            ...c,
            name: name || c.name, // retain original name if new name is blank
            items: [...cart],
            total: _calcTotal(cart),
            savedAt: new Date().toISOString(),
          };
        }
        return c;
      });
    } else {
      // Create new held cart
      const newCart = {
        id: String(Date.now()),
        name: name || `Cart #${savedCarts.length + 1}`,
        items: [...cart],
        total: _calcTotal(cart),
        savedAt: new Date().toISOString(),
      };
      const MAX_SAVED = 10;
      updated = [newCart, ...savedCarts].slice(0, MAX_SAVED);
    }

    try {
      await SecureStore.setItemAsync('pos_saved_carts', JSON.stringify(updated));
      set({
        savedCarts: updated,
        cart: [],
        grandTotal: 0,
        activeSavedCartId: null,
      });
    } catch (e) {
      console.error('Failed to save carts:', e);
    }
  },

  loadSavedCart: async (id) => {
    const { savedCarts } = get();
    const cartToLoad = savedCarts.find(c => c.id === id);
    if (!cartToLoad) return;

    set({
      cart: cartToLoad.items,
      grandTotal: _calcTotal(cartToLoad.items),
      activeSavedCartId: id,
    });
  },

  deleteSavedCart: async (id) => {
    const { savedCarts, activeSavedCartId } = get();
    const updated = savedCarts.filter(c => c.id !== id);
    try {
      await SecureStore.setItemAsync('pos_saved_carts', JSON.stringify(updated));
      set({
        savedCarts: updated,
        activeSavedCartId: activeSavedCartId === id ? null : activeSavedCartId
      });
    } catch (e) {
      console.error('Failed to delete cart:', e);
    }
  },

  // ── Price override ────────────────────────────────────────────────────────
  openPriceOverride: (item) => {
    set({ isPriceOverrideOpen: true, overrideItem: item });
  },

  closePriceOverride: () => {
    set({ isPriceOverrideOpen: false, overrideItem: null });
  },

  // ── Settlement ────────────────────────────────────────────────────────────
  openSettlement: () => {
    set({ isSettlementOpen: true });
  },

  closeSettlement: () => {
    set({ isSettlementOpen: false });
  },

  // ── Submit ────────────────────────────────────────────────────────────────
  submitInvoice: async (paymentData) => {
    const { cart, activeSavedCartId, savedCarts } = get();
    const lines = cart.map((item) => ({
      part_id: item.part_id,
      quantity: item.quantity,
      sale_price: item.sale_price,
      discount_amount: 0,
    }));

    const stagingPayload = {
      customer_id: paymentData.customer_id,
      employee_id: paymentData.employee_id,
      lines,
      tax_rate_id: paymentData.tax_rate_id || null,
      payment_method_id: paymentData.payment_method_id,
      tendered_amount: paymentData.tendered_amount !== null && paymentData.tendered_amount !== undefined ? Number(paymentData.tendered_amount) : null,
      physical_receipt_no: paymentData.physical_receipt_no || null,
    };

    const { data } = await apiClient.post('/sales/staging', stagingPayload);

    // If it was a loaded saved cart, delete it from the queue now that it's complete!
    if (activeSavedCartId) {
      const updated = savedCarts.filter(c => c.id !== activeSavedCartId);
      try {
        await SecureStore.setItemAsync('pos_saved_carts', JSON.stringify(updated));
        set({ savedCarts: updated, activeSavedCartId: null });
      } catch (e) {
        console.error('Failed to update saved carts on complete:', e);
      }
    }

    return {
      staged_sale_id: data.staged_sale_id,
      invoice_number: data.staged_number,
      grand_total: stagingPayload.lines.reduce((s, l) => s + (l.sale_price * l.quantity), 0),
      customer_name: paymentData.customer_name
    };
  },
}));

// ── Internal helpers ──────────────────────────────────────────────────────────
function _calcTotal(cart) {
  return cart.reduce((sum, i) => sum + i.quantity * i.sale_price, 0);
}

function _syncSavedCarts(savedCarts, activeId, newCartItems) {
  if (!activeId) return savedCarts;
  const updated = savedCarts.map(c => {
    if (c.id === activeId) {
      return {
        ...c,
        items: newCartItems,
        total: _calcTotal(newCartItems),
        savedAt: new Date().toISOString(),
      };
    }
    return c;
  });
  SecureStore.setItemAsync('pos_saved_carts', JSON.stringify(updated)).catch(e => {
    console.error('Failed to sync saved carts:', e);
  });
  return updated;
}

export default usePosStore;
