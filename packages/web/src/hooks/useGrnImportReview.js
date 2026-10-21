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
  const [candidateResultsByRow, setCandidateResultsByRow] = useState({});
  const candidateRequestsRef = useRef(new Map());
  const currentReviewRef = useRef(null);
  currentReviewRef.current = { importId: activeImportId, version: review?.version };

  useEffect(() => {
    const requests = candidateRequestsRef.current;
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
    setCandidatesByRow({});
    setCandidateResultsByRow({});
    setCandidatesLoadingRow(null);
    return () => {
      for (const request of requests.values()) request.controller.abort();
      requests.clear();
    };
  }, [activeImportId, review?.version]);

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
  const queueAction = useCallback((action, selectedPart = null) => {
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
              ...(action.values.part_id !== undefined ? {
                part_display_name: selectedPart?.display_name || selectedPart?.detail || selectedPart?.internal_sku || null,
              } : {}),
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
      setReview(prev => ({ ...prev, ...res.data }));
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
    const requests = candidateRequestsRef.current;
    requests.get(rowId)?.controller.abort();
    requests.delete(rowId);
    if (requests.size >= 2) {
      const oldest = requests.keys().next().value;
      requests.get(oldest).controller.abort();
      requests.delete(oldest);
    }
    const request = { controller: new AbortController() };
    requests.set(rowId, request);
    const isCurrent = () => requests.get(rowId) === request
      && currentReviewRef.current?.importId === activeImportId
      && currentReviewRef.current?.version === review.version;
    setCandidatesLoadingRow(rowId);
    setCandidatesByRow(prev => ({ ...prev, [rowId]: [] }));
    setCandidateResultsByRow(prev => ({ ...prev, [rowId]: null }));
    try {
      const res = await api.post(`/goods-receipts/imports/${activeImportId}/candidates`, {
        version: review.version,
        row_id: rowId,
        query,
      }, { signal: request.controller.signal });
      if (!isCurrent() || res.data.version !== review.version || res.data.row_id !== rowId) return;
      setCandidatesByRow(prev => ({
        ...prev,
        [rowId]: res.data.candidates || [],
      }));
      setCandidateResultsByRow(prev => ({ ...prev, [rowId]: {
        ai_status: res.data.ai_status, verification: res.data.verification, search_status: res.data.search_status,
      } }));
    } catch (err) {
      if (isCurrent() && !request.controller.signal.aborted) {
        setCandidateResultsByRow(prev => ({ ...prev, [rowId]: { search_status: 'unavailable' } }));
      }
    } finally {
      if (requests.get(rowId) === request) {
        requests.delete(rowId);
        setCandidatesLoadingRow(current => current === rowId ? null : current);
      }
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
    candidateResultsByRow,
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
