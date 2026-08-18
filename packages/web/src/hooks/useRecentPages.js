import { useMemo, useCallback } from 'react';
import useLocalStorage from './useLocalStorage';
import { useAuth } from '../contexts/AuthContext';
import { getAllNavItems } from '../config/navigation';

const HISTORY_KEY = 'forson_recent_pages';
const MAX_HISTORY = 20;
const MAX_SECTION = 5;

/**
 * Tracks page-visit recency/frequency in localStorage so the command palette
 * can suggest "Recent" and "Frequent" tools. Records every navigation
 * (App.jsx's handleNavigate calls recordVisit centrally), not just palette use.
 */
function useRecentPages() {
    const { hasPermission } = useAuth();
    const [history, setHistory] = useLocalStorage(HISTORY_KEY, []);

    const recordVisit = useCallback((id) => {
        if (!id) return;
        setHistory(prev => {
            const existing = prev.find(entry => entry.id === id);
            const next = existing
                ? prev.map(entry => entry.id === id ? { ...entry, ts: Date.now(), count: entry.count + 1 } : entry)
                : [{ id, ts: Date.now(), count: 1 }, ...prev];

            if (next.length <= MAX_HISTORY) return next;
            return [...next].sort((a, b) => b.ts - a.ts).slice(0, MAX_HISTORY);
        });
    }, [setHistory]);

    const resolvedItems = useMemo(() => {
        const navItemsById = new Map(getAllNavItems().map(item => [item.id, item]));
        return history
            .map(entry => {
                const item = navItemsById.get(entry.id);
                if (!item || !hasPermission(item.permission)) return null;
                return { ...item, ts: entry.ts, count: entry.count };
            })
            .filter(Boolean);
    }, [history, hasPermission]);

    const recent = useMemo(
        () => [...resolvedItems].sort((a, b) => b.ts - a.ts).slice(0, MAX_SECTION),
        [resolvedItems]
    );

    const frequent = useMemo(() => {
        const recentIds = new Set(recent.map(item => item.id));
        return [...resolvedItems]
            .filter(item => !recentIds.has(item.id))
            .sort((a, b) => b.count - a.count)
            .slice(0, MAX_SECTION);
    }, [resolvedItems, recent]);

    return { recordVisit, recent, frequent };
}

export default useRecentPages;
