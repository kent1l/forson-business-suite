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

  startAdHocCount: (partData) => {
    set({ isAdHocMode: true, currentAdHocItem: partData });
  },

  clearAdHocMode: () => {
    set({ isAdHocMode: false, currentAdHocItem: null });
  },

  submitAdHocCount: async (countedQty, startedAt) => {
    const { currentAdHocItem } = get();
    if (!currentAdHocItem) throw new Error('No ad-hoc item set');
    const { data } = await apiClient.post('/inventory/cycle-count/unassigned-find', {
      part_id: currentAdHocItem.part_id ?? currentAdHocItem.id,
      counted_qty: countedQty,
      started_at: startedAt,
    });
    return data;
  },
}));

export default useCycleCountStore;
