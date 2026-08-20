import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { formatISO } from 'date-fns';

// LocalStorage key prefix (kept as-is for backwards compatibility with sales already saved by POS)
const KEY_PREFIX_DEFAULT = 'pos:savedSales:';
const MAX_SAVES_DEFAULT = 10;

// shape: { id, userId, createdAt, label, cart: { items, customerId, notes, totals } }
// storagePrefix/labelPrefix let other pages (e.g. Invoicing) keep their own drafts in a separate
// localStorage namespace and with their own label wording, without touching POS's saved sales.
export default function useSavedSales({ userId, max = MAX_SAVES_DEFAULT, storagePrefix = KEY_PREFIX_DEFAULT, labelPrefix = 'Sale' }) {
  const [saved, setSaved] = useState([]);

  const storageKey = `${storagePrefix}${userId || 'anonymous'}`;

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
    const label = `${labelPrefix} ${saved.length + 1}`; // simple incremental label
    const entry = {
      id,
      userId,
      createdAt: formatISO(new Date()),
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
  }, [userId, saved, max, persist, labelPrefix]);

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
