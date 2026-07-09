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
      const qtyToAdd = product._forceQty || 1;
      if (existing) {
        const cart = state.cart.map((i) =>
          i.part_id === product.part_id
            ? { ...i, quantity: i.quantity + qtyToAdd }
            : i,
        );
        return { cart, grandTotal: _calcTotal(cart) };
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
        sale_price: product.last_sale_price ?? product.sale_price ?? 0,
        quantity: initialQty,
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
    // Step 1: Create the invoice header and lines
    const invoicePayload = {
      customer_id: paymentData.customer_id,
      employee_id: paymentData.employee_id,
      lines,
      physical_receipt_no: paymentData.physical_receipt_no || null,
      tax_rate_id: paymentData.tax_rate_id || null,
    };
    const { data: invoiceData } = await apiClient.post('/invoices', invoicePayload);
    const invoiceId = invoiceData.invoice_id;

    // Step 2: Post the payment using the new payment route
    const paymentPayload = {
      payments: [{
        method_id: paymentData.payment_method_id,
        amount_paid: Number(invoiceData.total_amount) || 0,
        tendered_amount: paymentData.tendered_amount !== null && paymentData.tendered_amount !== undefined ? Number(paymentData.tendered_amount) : null,
        reference: paymentData.physical_receipt_no || null,
        metadata: {
          method_name: paymentData.payment_method,
          source: 'pos_mobile'
        }
      }],
      physical_receipt_no: paymentData.physical_receipt_no || null
    };
    await apiClient.post(`/invoices/${invoiceId}/payments`, paymentPayload);

    return invoiceData;
  },
}));

// ── Internal helper ───────────────────────────────────────────────────────────
function _calcTotal(cart) {
  return cart.reduce((sum, i) => sum + i.quantity * i.sale_price, 0);
}

export default usePosStore;
