import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

export default function useGrnImportReview({ onCommitted, onError } = {}) {
  const [capabilities, setCapabilities] = useState(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);

  const [activeImportId, setActiveImportId] = useState(null);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingActions, setPendingActions] = useState([]);

  // Candidate cache and in-flight tracking
  const [candidatesByRow, setCandidatesByRow] = useState({});
  const [candidatesLoadingRow, setCandidatesLoadingRow] = useState(null);
  const candidateReqCountRef = useRef(0);

  // Fetch capabilities on mount
  useEffect(() => {
    let mounted = true;
    api.get('/goods-receipts/import-capabilities')
      .then(res => {
        if (mounted) {
          setCapabilities(res.data);
          setCapabilitiesLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setCapabilities({ enabled: false });
          setCapabilitiesLoading(false);
        }
      });
    return () => { mounted = false; };
  }, []);

  // Fetch review by ID
  const fetchReview = useCallback(async (importId) => {
    if (!importId) return null;
    setLoading(true);
    try {
      const res = await api.get(`/goods-receipts/imports/${importId}`);
      setReview(res.data);
      setActiveImportId(importId);
      setPendingActions([]);
      setHasUnsavedChanges(false);
      setLoading(false);
      return res.data;
    } catch (err) {
      setLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [onError]);

  // Create new import
  const createImport = useCallback(async ({ requestKey, payload, context = {} }) => {
    setLoading(true);
    try {
      const res = await api.post('/goods-receipts/imports', {
        request_key: requestKey,
        payload,
        context,
      });
      const data = res.data;
      setActiveImportId(data.import_id);
      // Fetch full review details
      const full = await fetchReview(data.import_id);
      return full;
    } catch (err) {
      setLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [fetchReview, onError]);

  // Queue a typed action locally
  const queueAction = useCallback((action) => {
    setPendingActions(prev => [...prev, action]);
    setHasUnsavedChanges(true);

    // Optimistically apply to review state if possible
    setReview(prev => {
      if (!prev || !prev.review_state) return prev;
      const state = { ...prev.review_state };

      if (action.type === 'set_header') {
        state.header = { ...state.header, ...action.values, header_confirmed: false };
      } else if (action.type === 'set_row') {
        const rows = [...state.rows];
        const idx = rows.findIndex(r => r.row_id === action.row_id);
        if (idx >= 0) {
          rows[idx] = {
            ...rows[idx],
            confirmed_row: {
              ...rows[idx].confirmed_row,
              ...action.values,
              row_confirmed: false,
            },
          };
          state.rows = rows;
        }
      } else if (action.type === 'set_inclusion') {
        const rows = [...state.rows];
        const idx = rows.findIndex(r => r.row_id === action.row_id);
        if (idx >= 0) {
          rows[idx] = {
            ...rows[idx],
            included: action.included,
            exclusion_reason: action.reason || null,
          };
          state.rows = rows;
        }
      }
      return { ...prev, review_state: state };
    });
  }, []);

  // Flush queued actions via PATCH
  const saveReview = useCallback(async (overrideActions = null) => {
    const actionsToSend = overrideActions || pendingActions;
    if (!activeImportId || !review || actionsToSend.length === 0) {
      return review;
    }

    setSaving(true);
    try {
      const res = await api.patch(`/goods-receipts/imports/${activeImportId}`, {
        version: review.version,
        actions: actionsToSend,
      });
      setReview(res.data);
      setPendingActions([]);
      setHasUnsavedChanges(false);
      setSaving(false);
      return res.data;
    } catch (err) {
      setSaving(false);
      if (err.response?.status === 409) {
        // Version conflict: refresh state
        await fetchReview(activeImportId);
      }
      if (onError) onError(err);
      throw err;
    }
  }, [activeImportId, review, pendingActions, fetchReview, onError]);

  // Fetch candidates for a row with debounce and concurrency limit
  const fetchCandidates = useCallback(async (rowId, query = null) => {
    if (!activeImportId || !review) return;
    if (candidateReqCountRef.current >= 2) return; // Concurrency limit of 2

    candidateReqCountRef.current += 1;
    setCandidatesLoadingRow(rowId);
    try {
      const res = await api.post(`/goods-receipts/imports/${activeImportId}/candidates`, {
        version: review.version,
        row_id: rowId,
        query,
      });
      setCandidatesByRow(prev => ({
        ...prev,
        [rowId]: res.data.candidates || [],
      }));
    } catch (err) {
      console.warn('Candidate fetch failed:', err.message);
    } finally {
      candidateReqCountRef.current = Math.max(0, candidateReqCountRef.current - 1);
      setCandidatesLoadingRow(null);
    }
  }, [activeImportId, review]);

  // Abandon review
  const abandonReview = useCallback(async (reason) => {
    if (!activeImportId || !review) return;
    setLoading(true);
    try {
      const res = await api.post(`/goods-receipts/imports/${activeImportId}/abandon`, {
        version: review.version,
        reason,
      });
      setReview(prev => ({ ...prev, status: 'ABANDONED' }));
      setLoading(false);
      return res.data;
    } catch (err) {
      setLoading(false);
      if (onError) onError(err);
      throw err;
    }
  }, [activeImportId, review, onError]);

  // Commit review to GRN draft
  const commitReview = useCallback(async () => {
    if (!activeImportId || !review) return;

    // First save any pending actions
    if (pendingActions.length > 0) {
      await saveReview();
    }

    setCommitting(true);
    try {
      const res = await api.post(`/goods-receipts/imports/${activeImportId}/commit`, {
        version: review.version,
      });
      setCommitting(false);
      if (onCommitted) onCommitted(res.data);
      return res.data;
    } catch (err) {
      setCommitting(false);
      if (onError) onError(err);
      throw err;
    }
  }, [activeImportId, review, pendingActions, saveReview, onCommitted, onError]);

  const closeReview = useCallback(() => {
    setActiveImportId(null);
    setReview(null);
    setPendingActions([]);
    setHasUnsavedChanges(false);
  }, []);

  return {
    capabilities,
    capabilitiesLoading,
    activeImportId,
    review,
    loading,
    saving,
    committing,
    hasUnsavedChanges,
    pendingActions,
    candidatesByRow,
    candidatesLoadingRow,
    fetchReview,
    createImport,
    queueAction,
    saveReview,
    fetchCandidates,
    abandonReview,
    commitReview,
    closeReview,
  };
}
