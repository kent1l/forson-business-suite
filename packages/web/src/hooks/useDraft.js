import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

// Reusable hook for draft (session) persistence with slot isolation and revision guards
// Params:
// - type: string key for the draft route e.g. 'po', 'goods-receipt'
// - options: {
//     slot?: string,           // slot name for multi-tab/context isolation (default: 'Draft')
//     data: any,              // the object to save
//     isEmpty: (data) => bool // skip saving if true
//     debounceMs?: number,
//     autoLoad?: boolean,
//     readyToSave?: boolean   // suppress autosave until hydrated
//   }
// Returns { status, lastSavedAt, draft, loaded, loadDraft, saveNow, clearDraft, error, slot }
export default function useDraft(type, {
  slot = 'Draft',
  data,
  isEmpty,
  debounceMs = 750,
  autoLoad = true,
  readyToSave = true,
} = {}) {
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error | conflict
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const saveTimerRef = useRef(null);
  const revisionRef = useRef(null);

  const endpoint = useMemo(() => `/drafts/${type}`, [type]);

  const loadDraft = useCallback(async () => {
    try {
      const res = await api.get(endpoint, { params: { slot, meta: 'true' } });
      const draftPayload = res.data?.data !== undefined ? res.data.data : res.data;
      const revision = res.data?.last_updated || res.headers['x-draft-revision'] || null;
      revisionRef.current = revision;
      setDraft(draftPayload || null);
      setLoaded(true);
      return draftPayload || null;
    } catch (err) {
      if (err?.response?.status !== 404) {
        setError(err);
      }
      setLoaded(true);
      return null;
    }
  }, [endpoint, slot]);

  const doSave = useCallback(async (payload) => {
    if (!readyToSave) return;
    if (!payload || (typeof isEmpty === 'function' && isEmpty(payload))) return;
    try {
      setStatus('saving');
      const res = await api.post(endpoint, {
        data: payload,
        slot,
        expected_revision: revisionRef.current,
      });
      if (res.data?.last_updated) {
        revisionRef.current = res.data.last_updated;
      }
      setStatus('saved');
      setLastSavedAt(new Date());
      setError(null);
    } catch (err) {
      if (err?.response?.status === 409 && err?.response?.data?.code === 'DRAFT_CONFLICT') {
        setStatus('conflict');
        setError(err);
      } else {
        setStatus('error');
        setError(err);
      }
    }
  }, [endpoint, slot, readyToSave, isEmpty]);

  const saveNow = useCallback(() => doSave(data), [doSave, data]);

  const clearDraft = useCallback(async () => {
    try {
      await api.delete(endpoint, { params: { slot } });
      setDraft(null);
      revisionRef.current = null;
      setStatus('idle');
      setLastSavedAt(null);
      setError(null);
    } catch (err) {
      console.error('Failed to clear draft', err);
    }
  }, [endpoint, slot]);

  // Auto-load when slot or autoLoad changes
  useEffect(() => {
    if (!autoLoad) return;
    loadDraft();
  }, [autoLoad, loadDraft]);

  // Debounced autosave when data changes
  useEffect(() => {
    if (!readyToSave || !loaded) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveNow();
    }, debounceMs);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [saveNow, debounceMs, readyToSave, loaded]);

  return { status, lastSavedAt, draft, loaded, loadDraft, saveNow, clearDraft, error, slot };
}
