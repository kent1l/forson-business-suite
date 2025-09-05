import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

// Reusable hook for draft (session) persistence
// Params:
// - type: string key for the draft route e.g. 'po', 'goods-receipt'
// - options: {
//     data: any,              // the object to save
//     isEmpty: (data) => bool // skip saving if true
//     debounceMs?: number,
//     autoLoad?: boolean
//   }
// Returns { status, lastSavedAt, draft, loaded, loadDraft, saveNow, clearDraft, error }
export default function useDraft(type, { data, isEmpty, debounceMs = 750, autoLoad = true } = {}) {
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const saveTimerRef = useRef(null);

  const endpoint = useMemo(() => `/drafts/${type}`, [type]);

  const loadDraft = useCallback(async () => {
    try {
      const res = await api.get(endpoint);
      setDraft(res.data || null);
      setLoaded(true);
      return res.data || null;
    } catch (err) {
      // 404 means no draft — not an error state
      if (err?.response?.status !== 404) {
        setError(err);
      }
      setLoaded(true);
      return null;
    }
  }, [endpoint]);

  const doSave = useCallback(async (payload) => {
    if (!payload || (typeof isEmpty === 'function' && isEmpty(payload))) return;
    try {
      setStatus('saving');
      await api.post(endpoint, payload);
      setStatus('saved');
      setLastSavedAt(new Date());
      setError(null);
    } catch (err) {
      setStatus('error');
      setError(err);
    }
  }, [endpoint, isEmpty]);

  const saveNow = useCallback(() => doSave(data), [doSave, data]);

  const clearDraft = useCallback(async () => {
    try {
      await api.delete(endpoint);
      setDraft(null);
      setStatus('idle');
      setLastSavedAt(null);
      setError(null);
    } catch (err) {
      // Log but don't surface as blocking UI error
      console.error('Failed to clear draft', err);
    }
  }, [endpoint]);

  // Auto-load once
  useEffect(() => {
    if (!autoLoad) return;
    loadDraft();
  }, [autoLoad, loadDraft]);

  // Debounced autosave when data changes
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveNow();
    }, debounceMs);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [saveNow, debounceMs]);

  return { status, lastSavedAt, draft, loaded, loadDraft, saveNow, clearDraft, error };
}
