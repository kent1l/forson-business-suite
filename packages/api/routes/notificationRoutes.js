const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const notificationService = require('../services/notificationService');

const router = express.Router();

/**
 * Notification centre endpoints.
 *
 * None of these carry a `hasPermission` guard, and that is deliberate: a
 * notification's audience is baked into the row itself (required_permission /
 * target_employee_id) and enforced inside notificationService's visibility
 * predicate. Gating the routes as well would only decide who may open the bell,
 * not what they see in it.
 */

// GET /api/notifications/unread-count — the badge. Polled, so kept trivial.
router.get('/notifications/unread-count', protect, async (req, res) => {
    try {
        const count = await notificationService.unreadCount(req.user);
        res.json({ count });
    } catch (err) {
        console.error('Failed to fetch unread notification count', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/notifications?limit=20&before=<cursor>&unread_only=true
router.get('/notifications', protect, async (req, res) => {
    try {
        const { limit, before, unread_only: unreadOnly } = req.query;
        const result = await notificationService.list(req.user, {
            limit,
            before: before ? Number(before) : null,
            unreadOnly: unreadOnly === 'true',
        });
        res.json(result);
    } catch (err) {
        console.error('Failed to list notifications', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/notifications/read-all — must be declared before the /:id routes,
// otherwise Express matches 'read-all' as an :id.
router.post('/notifications/read-all', protect, async (req, res) => {
    try {
        await notificationService.markAllRead(req.user);
        res.json({ count: await notificationService.unreadCount(req.user) });
    } catch (err) {
        console.error('Failed to mark all notifications read', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/notifications/:id/read  { read: false } to undo.
router.post('/notifications/:id/read', protect, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid notification id' });

    try {
        const read = req.body && req.body.read === false ? false : true;
        const ok = await notificationService.setReceipt(req.user, id, { read });
        // Same 404 whether the notification is missing or simply not visible to
        // this user — otherwise the response distinguishes the two and leaks
        // the existence of alerts the caller has no business knowing about.
        if (!ok) return res.status(404).json({ message: 'Notification not found' });
        res.json({ count: await notificationService.unreadCount(req.user) });
    } catch (err) {
        console.error('Failed to update notification read state', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/notifications/:id/dismiss — removes it from this user's list only.
router.post('/notifications/:id/dismiss', protect, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid notification id' });

    try {
        // Dismissing implies reading: a dismissed item must not keep the badge lit.
        const ok = await notificationService.setReceipt(req.user, id, { read: true, dismissed: true });
        if (!ok) return res.status(404).json({ message: 'Notification not found' });
        res.json({ count: await notificationService.unreadCount(req.user) });
    } catch (err) {
        console.error('Failed to dismiss notification', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
