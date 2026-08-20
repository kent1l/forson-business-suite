import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../api';

const useNotifications = () => {
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [open, setOpen] = useState(false);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const cursorRef = useRef(null);
    // Guards all setState calls so in-flight requests don't update unmounted state.
    const mountedRef = useRef(true);

    useEffect(() => {
        // Re-arming on every mount is what makes this work under StrictMode,
        // which mounts, unmounts, then remounts in development. Setting the flag
        // only in the cleanup would leave it false for the surviving mount, and
        // every later setState would be silently skipped — the panel would fetch
        // successfully and then render nothing at all.
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // Polling is gated on tab visibility: a hidden tab must not poll.
    // The visibilitychange listener also provides an immediate refetch on
    // tab restore, so the badge is never stale when the user returns.
    const refreshCount = useCallback(async () => {
        if (document.hidden) return;
        try {
            const { data } = await api.get('/notifications/unread-count');
            if (mountedRef.current) setUnreadCount(data.count);
        } catch { /* badge stays at last-known value rather than alarming */ }
    }, []);

    useEffect(() => {
        refreshCount();
        const interval = setInterval(() => {
            if (!document.hidden) refreshCount();
        }, 60_000);

        const onVisibility = () => { if (!document.hidden) refreshCount(); };
        const onFocus = () => refreshCount();

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
        };
    }, [refreshCount]);

    const loadFirstPage = useCallback(async (newUnreadOnly) => {
        setLoading(true);
        setError(null);
        cursorRef.current = null;
        try {
            const params = { limit: 20, ...(newUnreadOnly && { unread_only: true }) };
            const { data } = await api.get('/notifications', { params });
            if (!mountedRef.current) return;
            setNotifications(data.notifications);
            setHasMore(data.nextCursor !== null);
            cursorRef.current = data.nextCursor;
        } catch (err) {
            if (mountedRef.current) setError(err);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    const loadMore = useCallback(async (currentUnreadOnly) => {
        if (!hasMore || loading) return;
        setLoading(true);
        try {
            const params = {
                limit: 20,
                before: cursorRef.current,
                ...(currentUnreadOnly && { unread_only: true }),
            };
            const { data } = await api.get('/notifications', { params });
            if (!mountedRef.current) return;
            setNotifications(prev => [...prev, ...data.notifications]);
            setHasMore(data.nextCursor !== null);
            cursorRef.current = data.nextCursor;
        } catch (err) {
            if (mountedRef.current) setError(err);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [hasMore, loading]);

    // Mutations update state optimistically and reconcile the badge from the
    // response count rather than issuing a separate GET, avoiding a race.
    const markRead = useCallback(async (id, read = true) => {
        const prevNotifications = notifications;
        const prevCount = unreadCount;
        setNotifications(ns => ns.map(n =>
            n.notification_id === id ? { ...n, is_read: read } : n
        ));
        try {
            const { data } = await api.post(`/notifications/${id}/read`, { read });
            if (mountedRef.current) setUnreadCount(data.count);
        } catch {
            if (mountedRef.current) {
                setNotifications(prevNotifications);
                setUnreadCount(prevCount);
                toast.error('Could not update notification.');
            }
        }
    }, [notifications, unreadCount]);

    const markAllRead = useCallback(async () => {
        const prevNotifications = notifications;
        const prevCount = unreadCount;
        setNotifications(ns => ns.map(n => ({ ...n, is_read: true })));
        setUnreadCount(0);
        try {
            const { data } = await api.post('/notifications/read-all');
            if (mountedRef.current) setUnreadCount(data.count);
        } catch {
            if (mountedRef.current) {
                setNotifications(prevNotifications);
                setUnreadCount(prevCount);
                toast.error('Could not mark all as read.');
            }
        }
    }, [notifications, unreadCount]);

    const dismiss = useCallback(async (id) => {
        const prevNotifications = notifications;
        const prevCount = unreadCount;
        setNotifications(ns => ns.filter(n => n.notification_id !== id));
        try {
            const { data } = await api.post(`/notifications/${id}/dismiss`);
            if (mountedRef.current) setUnreadCount(data.count);
        } catch {
            if (mountedRef.current) {
                setNotifications(prevNotifications);
                setUnreadCount(prevCount);
                toast.error('Could not dismiss notification.');
            }
        }
    }, [notifications, unreadCount]);

    return {
        unreadCount, notifications, loading, error, hasMore,
        open, setOpen,
        unreadOnly, setUnreadOnly,
        loadFirstPage, loadMore,
        markRead, markAllRead, dismiss, refreshCount,
    };
};

export default useNotifications;
