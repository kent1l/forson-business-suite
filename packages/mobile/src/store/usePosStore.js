import { create } from 'zustand';
import apiClient from '../api/client';

const usePosStore = create((set, get) => ({
  // ── Cart state ────────────────────────────────────────────────────────────
  cart: [],
  grandTotal: 0,

  // ── UI state ──────────────────────────────────────────────────────────────
  isPriceOverrideOpen: false,
  overrideItem: null,
  isSettlementOpen: false,

  // ── Cart actions ──────────────────────────────────────────────────────────
  addToCart: (product) => {
    set((state) => {
      const existing = state.cart.find((i) => i.part_id === product.part_id);
      if (existing) {
        const cart = state.cart.map((i) =>
          i.part_id === product.part_id
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        );
        return { cart, grandTotal: _calcTotal(cart) };
      }
      const isSparkPlug = /spark\s*plug/i.test(
        `${product.name || ''} ${product.detail || ''}`,
      );
      const item = {
        part_id: product.part_id,
        detail: product.detail,
        display_name: product.display_name,
        part_numbers: product.part_numbers,
        brand_name: product.brand_name,
        sale_price: product.sale_price,
        quantity: isSparkPlug ? 4 : 1,
        stock_qty: product.stock_qty,
        is_tax_inclusive_price: product.is_tax_inclusive_price,
      };
      const cart = [...state.cart, item];
      return { cart, grandTotal: _calcTotal(cart) };
    });
  },

  removeFromCart: (partId) => {
    set((state) => {
      const cart = state.cart.filter((i) => i.part_id !== partId);
      return { cart, grandTotal: _calcTotal(cart) };
    });
  },

  updateQuantity: (partId, qty) => {
    set((state) => {
      const cart = state.cart.map((i) =>
        i.part_id === partId ? { ...i, quantity: Math.max(1, qty) } : i,
      );
      return { cart, grandTotal: _calcTotal(cart) };
    });
  },

  updatePrice: (partId, newPrice) => {
    set((state) => {
      const cart = state.cart.map((i) =>
        i.part_id === partId ? { ...i, sale_price: newPrice } : i,
      );
      return { cart, grandTotal: _calcTotal(cart) };
    });
  },

  clearCart: () => {
    set({ cart: [], grandTotal: 0 });
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
    const { cart } = get();
    const lines = cart.map((item) => ({
      part_id: item.part_id,
      quantity: item.quantity,
      sale_price: item.sale_price,
      discount_amount: 0,
    }));
    const payload = {
      customer_id: paymentData.customer_id,
      employee_id: paymentData.employee_id,
      lines,
      amount_paid: paymentData.amount_paid,
      tendered_amount: paymentData.tendered_amount,
      payment_method: paymentData.payment_method,
      terms: paymentData.terms || 'COD',
      tax_rate_id: paymentData.tax_rate_id || null,
    };
    const { data } = await apiClient.post('/invoices', payload);
    return data;
  },
}));

// ── Internal helper ───────────────────────────────────────────────────────────
function _calcTotal(cart) {
  return cart.reduce((sum, i) => sum + i.quantity * i.sale_price, 0);
}

export default usePosStore;
