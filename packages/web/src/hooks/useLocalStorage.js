import { useState, useEffect, useCallback } from 'react';

/**
 * Industry-standard useLocalStorage hook.
 * - Initializes from localStorage on mount.
 * - Writes to localStorage on every set call.
 * - Dispatches a storage event so other tabs / components stay in sync.
 * - Gracefully falls back to defaultValue if localStorage is unavailable.
 *
 * @param {string} key            - localStorage key
 * @param {*}      defaultValue   - value to use when key is absent or storage fails
 * @returns {[any, Function]}     - [storedValue, setValue]
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
                // Notify other tabs / hook instances
                window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(next) }));
            } catch {
                // localStorage unavailable (private browsing quota exceeded, etc.)
            }
            return next;
        });
    }, [key]);

    // Keep in sync when another tab or component writes to the same key
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
