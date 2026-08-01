import { create } from 'zustand';
import apiClient from '../api/client';

const useCycleCountStore = create((set, get) => ({
  // ── Assigned batch ──────────────────────────────────────────────────────────
  activeBatchId: null,
  activeBatchData: null,
  activeLineId: null,

  setActiveBatch: (batchId, batchData = null, lineId = null) => {
    set({
      activeBatchId: batchId,
      activeBatchData: batchData,
      activeLineId: lineId,
      isAdHocMode: false,
      currentAdHocItem: null,
    });
  },

  clearActiveBatch: () => {
    set({ activeBatchId: null, activeBatchData: null, activeLineId: null });
  },

  // ── Ad-hoc (unassigned find) ─────────────────────────────────────────────
  isAdHocMode: false,
  currentAdHocItem: null,

  startAdHocCount: (partData, initialBarcode = null) => {
    set({
      isAdHocMode: true,
      currentAdHocItem: {
        ...partData,
        pendingBarcode: initialBarcode,
      },
    });
  },

  clearAdHocMode: () => {
    set({ isAdHocMode: false, currentAdHocItem: null });
  },

  submitAdHocCount: async (countedQty, startedAt, scannedBarcode = null) => {
    const { currentAdHocItem } = get();
    if (!currentAdHocItem) throw new Error('No ad-hoc item set');
    const payload = {
      part_id: currentAdHocItem.part_id ?? currentAdHocItem.id,
      counted_qty: countedQty,
      started_at: startedAt,
    };
    if (scannedBarcode) {
      payload.scanned_barcode = scannedBarcode;
    }
    const { data } = await apiClient.post('/inventory/cycle-count/unassigned-find', payload);
    return data;
  },
}));

export default useCycleCountStore;
