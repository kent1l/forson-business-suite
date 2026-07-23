import { useState, useEffect, useCallback } from 'react';

/**
 * useLocalStorage — persists state to localStorage with cross-tab sync.
 *
 * Cross-tab behaviour: browsers natively fire the `storage` event on all
 * OTHER windows/tabs when localStorage changes. We listen for that here.
 * We do NOT manually dispatch a StorageEvent for the current window —
 * doing so would cause the listener to double-fire and immediately revert
 * every state change (the "takes 2-5 clicks" bug).
 *
 * @param {string} key           - localStorage key
 * @param {*}      defaultValue  - fallback when key is absent or storage fails
 * @returns {[any, Function]}    - [storedValue, setValue]
 */
function useLocalStorage(key, defaultValue) {
    const [storedValue, setStoredValue] = useState(() => {
        try {
            const raw = window.localStorage.getItem(key);
            return raw !== null ? JSON.parse(raw) : defaultValue;
        } catch {
            return defaultValue;
        }
    });

    const setValue = useCallback((value) => {
        setStoredValue(prev => {
            const next = typeof value === 'function' ? value(prev) : value;
            try {
                window.localStorage.setItem(key, JSON.stringify(next));
                // NOTE: Do NOT dispatch a StorageEvent here.
                // The native storage event fires automatically for OTHER tabs.
                // Dispatching it here would re-trigger our own onStorage listener
                // and immediately toggle the value back (double-fire bug).
            } catch {
                // localStorage unavailable (private browsing / quota exceeded)
            }
            return next;
        });
    }, [key]);

    // Sync with other tabs / windows (not the current one)
    useEffect(() => {
        const onStorage = (e) => {
            if (e.key !== key) return;
            try {
                setStoredValue(e.newValue !== null ? JSON.parse(e.newValue) : defaultValue);
            } catch {
                setStoredValue(defaultValue);
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [key, defaultValue]);

    return [storedValue, setValue];
}

export default useLocalStorage;
