import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import submitWithOutbox from '../offline/submitWithOutbox';

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
      // Makes a resend idempotent -- without it a retried find, or one queued
      // offline, would insert a second cycle_count_line and (if the variance
      // auto-approves) double the stock adjustment that comes with it.
      client_ref: Crypto.randomUUID(),
    };
    if (scannedBarcode) {
      payload.scanned_barcode = scannedBarcode;
    }
    const outcome = await submitWithOutbox('cycle-count-adhoc', payload, {
      displayName: currentAdHocItem.display_name ?? currentAdHocItem.name,
    });
    return { ...outcome, data: outcome.queued ? null : outcome.data };
  },
}));

export default useCycleCountStore;
