import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { applyImportAction, importRowMatchKey, canAutomaticallyMatch } from '../utils/grnImportReview';

export default function useGrnImportReview({ onCommitted, onError, autoMatchEnabled = false } = {}) {
  const [capabilities, setCapabilities] = useState(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [activeImportId, setActiveImportId] = useState(null);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pendingActions, setPendingActions] = useState([]);
  const [candidatesByRow, setCandidatesByRow] = useState({});
  const [candidatesLoadingRow, setCandidatesLoadingRow] = useState(null);
  const [candidateResultsByRow, setCandidateResultsByRow] = useState({});
  const [autoMatchProgress, setAutoMatchProgress] = useState({ status: 'idle', total: 0, processed: 0, matched: 0 });
  const [autoMatchEpoch, setAutoMatchEpoch] = useState(0);

  const reviewRef = useRef(null);
  const importIdRef = useRef(null);
  const entriesRef = useRef([]);
  const entrySequenceRef = useRef(0);
  const saveLockRef = useRef(null);
  const candidateRequestsRef = useRef(new Map());
  const attemptedRef = useRef(new Set());
  const manuallySearchedRef = useRef(new Set());
  const automaticPartsRef = useRef(new Map());
  const autoRunRef = useRef(null);
  const callbacksRef = useRef({ onError, onCommitted });
  callbacksRef.current = { onError, onCommitted };

  const updateReview = useCallback(next => {
    reviewRef.current = next;
    setReview(next);
  }, []);

  const updateEntries = useCallback(entries => {
    entriesRef.current = entries;
    setPendingActions(entries.map(entry => entry.action));
  }, []);

  const rebaseReview = useCallback((response, entries) => {
    let next = { ...reviewRef.current, ...response };
    if (next.review_state) next = { ...next, review_state: { ...next.review_state,
      rows: next.review_state.rows.map(row => {
        const automatic = automaticPartsRef.current.get(row.row_id);
        return automatic?.part_id === row.confirmed_row?.part_id
          ? { ...row, confirmed_row: { ...row.confirmed_row, automatic_match: automatic } } : row;
      }),
    } };
    for (const entry of entries) next = applyImportAction(next, entry.action, entry.selectedPart);
    updateEntries(entries);
    updateReview(next);
    return next;
  }, [updateEntries, updateReview]);

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

  useEffect(() => {
    let mounted = true;
    api.get('/goods-receipts/import-capabilities')
      .then(res => { if (mounted) setCapabilities(res.data); })
      .catch(() => { if (mounted) setCapabilities({ enabled: false }); })
      .finally(() => { if (mounted) setCapabilitiesLoading(false); });
    return () => { mounted = false; };
  }, []);

  const fetchReview = useCallback(async importId => {
    if (!importId) return null;
    setLoading(true);
    try {
      const res = await api.get(`/goods-receipts/imports/${importId}`);
      importIdRef.current = importId;
      setActiveImportId(importId);
      attemptedRef.current.clear();
      manuallySearchedRef.current.clear();
      automaticPartsRef.current.clear();
      updateEntries([]);
      updateReview(res.data);
      return res.data;
    } catch (err) {
      callbacksRef.current.onError?.(err);
      throw err;
    } finally { setLoading(false); }
  }, [updateEntries, updateReview]);

  const createImport = useCallback(async ({ requestKey, payload, context = {} }) => {
    setLoading(true);
    try {
      const res = await api.post('/goods-receipts/imports', { request_key: requestKey, payload, context });
      return await fetchReview(res.data.import_id);
    } catch (err) {
      callbacksRef.current.onError?.(err);
      throw err;
    } finally { setLoading(false); }
  }, [fetchReview]);

  const enqueueAction = useCallback((action, selectedPart = null, automatic = false) => {
    if (automatic) action = { ...action, origin: 'automatic_match' };
    let entries = entriesRef.current;
    if (!automatic && action.type === 'set_row' && action.values.part_id !== undefined) {
      manuallySearchedRef.current.add(action.row_id);
      entries = entries.filter(entry => !entry.automatic || entry.action.row_id !== action.row_id);
      automaticPartsRef.current.delete(action.row_id);
    }
    if (automatic) automaticPartsRef.current.set(action.row_id, selectedPart.automatic_match);
    const entry = { id: ++entrySequenceRef.current, action, selectedPart, automatic };
    updateEntries([...entries, entry]);
    updateReview(applyImportAction(reviewRef.current, action, selectedPart));
  }, [updateEntries, updateReview]);

  // Serialize automatic/manual saves; replay edits made while PATCH was in flight.
  const flushPending = useCallback(async (automaticOnly = false) => {
    while (saveLockRef.current) await saveLockRef.current.catch(() => {});
    const importId = importIdRef.current;
    const run = async () => {
      let snapshot = reviewRef.current;
      if (!importId || snapshot?.status !== 'IN_REVIEW') return snapshot;
      setSaving(true);
      try {
        while (importIdRef.current === importId) {
          const batch = entriesRef.current.filter(entry => !automaticOnly || entry.automatic).slice(0, 50);
          if (!batch.length) break;
          snapshot = reviewRef.current;
          const res = await api.patch(`/goods-receipts/imports/${importId}`, {
            version: snapshot.version, actions: batch.map(entry => entry.action),
          });
          if (importIdRef.current !== importId) return reviewRef.current;
          const sentIds = new Set(batch.map(entry => entry.id));
          rebaseReview(res.data, entriesRef.current.filter(entry => !sentIds.has(entry.id)));
        }
        return reviewRef.current;
      } catch (err) {
        if (err.response?.status === 409 && importIdRef.current === importId) {
          const fresh = await api.get(`/goods-receipts/imports/${importId}`);
          // Automatic choices were based on an older revision; preserve manual work.
          const manual = entriesRef.current.filter(entry => !entry.automatic);
          automaticPartsRef.current.clear();
          rebaseReview(fresh.data, manual);
        }
        callbacksRef.current.onError?.(err);
        throw err;
      } finally { setSaving(false); }
    };
    const promise = run();
    saveLockRef.current = promise;
    try { return await promise; }
    finally { if (saveLockRef.current === promise) saveLockRef.current = null; }
  }, [rebaseReview]);

  const saveReview = useCallback(() => flushPending(false), [flushPending]);

  const queueAction = useCallback((action, selectedPart = null) => {
    enqueueAction(action, selectedPart);
    // Confirmation is a single visible action, including saving any preceding edits.
    if (action.type === 'confirm_row' || action.type === 'confirm_header') {
      void flushPending(false).catch(() => {}); // flushPending reports the error to the page.
    }
  }, [enqueueAction, flushPending]);

  const fetchCandidates = useCallback(async (rowId, query = null) => {
    const snapshot = reviewRef.current;
    const importId = importIdRef.current;
    if (!importId || !snapshot) return;
    manuallySearchedRef.current.add(rowId);
    const requests = candidateRequestsRef.current;
    requests.get(rowId)?.controller.abort();
    requests.delete(rowId);
    const autoControllers = autoRunRef.current?.controllers;
    while (autoControllers?.size && autoControllers.size + requests.size >= 2) {
      const controller = autoControllers.values().next().value;
      controller.abort();
      autoControllers.delete(controller);
    }
    if (requests.size >= 2) {
      const oldest = requests.keys().next().value;
      requests.get(oldest).controller.abort();
      requests.delete(oldest);
    }
    const request = { controller: new AbortController() };
    requests.set(rowId, request);
    const isCurrent = () => requests.get(rowId) === request && importIdRef.current === importId
      && reviewRef.current?.version === snapshot.version;
    setCandidatesLoadingRow(rowId);
    setCandidatesByRow(prev => ({ ...prev, [rowId]: [] }));
    setCandidateResultsByRow(prev => ({ ...prev, [rowId]: null }));
    try {
      const res = await api.post(`/goods-receipts/imports/${importId}/candidates`, {
        version: snapshot.version, row_id: rowId, query,
      }, { signal: request.controller.signal });
      if (!isCurrent() || res.data.version !== snapshot.version || res.data.row_id !== rowId) return;
      setCandidatesByRow(prev => ({ ...prev, [rowId]: res.data.candidates || [] }));
      setCandidateResultsByRow(prev => ({ ...prev, [rowId]: res.data }));
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
  }, []);

  useEffect(() => {
    if (!autoMatchEnabled || !capabilities?.enabled || !activeImportId || review?.status !== 'IN_REVIEW' || committing || loading) return;
    const run = { cancelled: false, controllers: new Set() };
    autoRunRef.current = run;
    const importId = activeImportId;
    let processed = 0;
    const matchedCount = () => (reviewRef.current?.review_state?.rows || []).filter(row => row.confirmed_row?.automatic_match).length;
    const eligible = () => (reviewRef.current?.review_state?.rows || []).filter(row =>
      canAutomaticallyMatch(reviewRef.current, row) && !manuallySearchedRef.current.has(row.row_id)
      && !attemptedRef.current.has(importRowMatchKey(reviewRef.current, row)));
    const total = eligible().length;
    setAutoMatchProgress({ status: total ? 'running' : 'complete', total, processed: 0, matched: matchedCount() });

    const work = async () => {
      let failed = false;
      try {
        while (!run.cancelled && importIdRef.current === importId) {
          const capacity = Math.max(0, 2 - candidateRequestsRef.current.size);
          const batch = eligible().slice(0, capacity);
          if (!eligible().length) break;
          if (!capacity) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
          const snapshot = reviewRef.current;
          await Promise.all(batch.map(async row => {
            const key = importRowMatchKey(snapshot, row);
            const controller = new AbortController();
            run.controllers.add(controller);
            try {
              const res = await api.post(`/goods-receipts/imports/${importId}/candidates`, {
                version: snapshot.version, row_id: row.row_id,
              }, { signal: controller.signal });
              const current = reviewRef.current;
              if (run.cancelled || controller.signal.aborted || importIdRef.current !== importId
                || current?.version !== snapshot.version || res.data.version !== snapshot.version || res.data.row_id !== row.row_id) return;
              const currentRow = current.review_state.rows.find(item => item.row_id === row.row_id);
              if (!currentRow || !canAutomaticallyMatch(current, currentRow) || manuallySearchedRef.current.has(row.row_id)
                || importRowMatchKey(current, currentRow) !== key) return;
              attemptedRef.current.add(key);
              processed += 1;
              const match = res.data.automatic_match;
              if (match?.part_id && (res.data.candidates || []).some(candidate => candidate.part_id === match.part_id)) {
                enqueueAction({ type: 'set_row', row_id: row.row_id, values: {
                  part_id: match.part_id, stock_uom: match.stock_uom,
                } }, { ...match, automatic_match: { part_id: match.part_id, method: match.method, confidence: match.confidence } }, true);
              }
            } catch (err) {
              if (!run.cancelled && !controller.signal.aborted) {
                if (err.response?.status === 409) throw err;
                attemptedRef.current.add(key);
                processed += 1;
                failed = true;
              }
            } finally { run.controllers.delete(controller); }
          }));
          if (importIdRef.current === importId) await flushPending(true);
          if (!run.cancelled) setAutoMatchProgress({ status: 'running', total, processed, matched: matchedCount() });
        }
      } catch (err) {
        failed = true;
        run.cancelled = true;
        for (const controller of run.controllers) controller.abort();
        if (err.response?.status === 409 && importIdRef.current === importId) {
          try {
            const fresh = await api.get(`/goods-receipts/imports/${importId}`);
            automaticPartsRef.current.clear();
            rebaseReview(fresh.data, entriesRef.current.filter(entry => !entry.automatic));
          } catch { /* Pending work remains available for the next save/retry. */ }
        }
      } finally {
        // Finish saving accepted matches even if the drawer closed during the other lookup.
        if (importIdRef.current === importId && entriesRef.current.some(entry => entry.automatic)) {
          try { await flushPending(true); } catch { failed = true; }
        }
        if (autoRunRef.current === run && importIdRef.current === importId) {
          setAutoMatchProgress({ status: failed ? 'error' : run.cancelled ? 'paused' : 'complete', total, processed, matched: matchedCount() });
        }
      }
    };
    work();
    return () => {
      run.cancelled = true;
      for (const controller of run.controllers) controller.abort();
    };
  }, [autoMatchEnabled, capabilities?.enabled, activeImportId, review?.status, committing, loading,
    autoMatchEpoch, enqueueAction, flushPending, rebaseReview]);

  const retryAutomaticMatching = useCallback(() => {
    attemptedRef.current.clear();
    manuallySearchedRef.current.clear();
    setAutoMatchEpoch(value => value + 1);
  }, []);

  const abandonReview = useCallback(async reason => {
    const importId = importIdRef.current;
    if (!importId || !reviewRef.current) return;
    setLoading(true);
    try {
      while (saveLockRef.current) await saveLockRef.current.catch(() => {});
      const res = await api.post(`/goods-receipts/imports/${importId}/abandon`, { version: reviewRef.current.version, reason });
      updateReview({ ...reviewRef.current, status: 'ABANDONED' });
      return res.data;
    } catch (err) { callbacksRef.current.onError?.(err); throw err; }
    finally { setLoading(false); }
  }, [updateReview]);

  const commitReview = useCallback(async () => {
    const importId = importIdRef.current;
    if (!importId || !reviewRef.current) return;
    setCommitting(true);
    try {
      await flushPending(false);
      const res = await api.post(`/goods-receipts/imports/${importId}/commit`, { version: reviewRef.current.version });
      callbacksRef.current.onCommitted?.(res.data);
      return res.data;
    } catch (err) { callbacksRef.current.onError?.(err); throw err; }
    finally { setCommitting(false); }
  }, [flushPending]);

  const closeReview = useCallback(() => {
    importIdRef.current = null;
    setActiveImportId(null);
    updateReview(null);
    updateEntries([]);
  }, [updateEntries, updateReview]);

  return {
    capabilities, capabilitiesLoading, activeImportId, review, loading, saving, committing,
    hasUnsavedChanges: pendingActions.length > 0, pendingActions,
    candidatesByRow, candidatesLoadingRow, candidateResultsByRow, autoMatchProgress,
    fetchReview, createImport, queueAction, saveReview, fetchCandidates, abandonReview,
    commitReview, closeReview, retryAutomaticMatching,
  };
}
