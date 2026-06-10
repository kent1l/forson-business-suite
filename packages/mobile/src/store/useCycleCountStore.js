import { create } from 'zustand';

const useCycleCountStore = create((set) => ({
  activeBatchId: null,
  activeBatchData: null,

  setActiveBatch: (batchId, batchData = null) => {
    set({
      activeBatchId: batchId,
      activeBatchData: batchData
    });
  },

  clearActiveBatch: () => {
    set({
      activeBatchId: null,
      activeBatchData: null
    });
  }
}));

export default useCycleCountStore;
