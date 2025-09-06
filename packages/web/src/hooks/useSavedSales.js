import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

// LocalStorage key prefix
const KEY_PREFIX = 'pos:savedSales:';
const MAX_SAVES_DEFAULT = 10;

// shape: { id, userId, createdAt, label, cart: { items, customerId, notes, totals } }
export default function useSavedSales({ userId, max = MAX_SAVES_DEFAULT }) {
  const [saved, setSaved] = useState([]);

  const storageKey = `${KEY_PREFIX}${userId || 'anonymous'}`;

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSaved(parsed);
        return parsed;
      }
    } catch (e) {
      console.error('[useSavedSales] load failed', e);
    }
    return [];
  }, [storageKey]);

  const persist = useCallback((list) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(list));
    } catch (e) {
      console.error('[useSavedSales] persist failed', e);
      toast.error('Unable to persist saved sales (storage full)');
    }
  }, [storageKey]);

  useEffect(() => {
    if (!userId) return; // wait for user id
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveSale = useCallback((cartSnapshot) => {
    if (!userId) {
      toast.error('User not identified. Cannot save sale.');
      return null;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const label = `Sale ${saved.length + 1}`; // simple incremental label
    const entry = {
      id,
      userId,
      createdAt: new Date().toISOString(),
      label,
      cart: cartSnapshot
    };
    let next = [entry, ...saved];
    if (next.length > max) {
      next = next.slice(0, max); // prune oldest beyond max (we keep newest first)
    }
    setSaved(next);
    persist(next);
    return entry;
  }, [userId, saved, max, persist]);

  const remove = useCallback((id) => {
    setSaved(prev => {
      const next = prev.filter(s => s.id !== id);
      persist(next);
      return next;
    });
  }, [persist]);

  const clearAll = useCallback(() => {
    setSaved([]);
    persist([]);
  }, [persist]);

  const get = useCallback((id) => saved.find(s => s.id === id) || null, [saved]);

  return { saved, count: saved.length, saveSale, remove, clearAll, get, reload: load };
}
