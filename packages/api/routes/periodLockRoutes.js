const express = require('express');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const periodLockService = require('../services/periodLockService');

const router = express.Router();

// GET /api/period-locks?module=expenses&months=12 - Lock state for the recent months
router.get('/period-locks', protect, hasPermission('expenses:manage_periods'), async (req, res) => {
    try {
        const months = Math.min(parseInt(req.query.months, 10) || 12, 36);
        const rows = await periodLockService.listRecentMonths({
            module: req.query.module || 'expenses',
            months
        });
        res.json(rows);
    } catch (error) {
        console.error('Error fetching period locks:', error);
        res.status(500).json({ message: 'Failed to fetch period locks' });
    }
});

// GET /api/period-locks/history - Full lock/unlock audit trail
router.get('/period-locks/history', protect, hasPermission('expenses:manage_periods'), async (req, res) => {
    try {
        const rows = await periodLockService.listLocks({
            module: req.query.module || 'expenses',
            months: Math.min(parseInt(req.query.months, 10) || 12, 36)
        });
        res.json(rows);
    } catch (error) {
        console.error('Error fetching period lock history:', error);
        res.status(500).json({ message: 'Failed to fetch period lock history' });
    }
});

// POST /api/period-locks/lock - Close a period
router.post('/period-locks/lock', protect, hasPermission('expenses:manage_periods'), async (req, res) => {
    const { period_month, module } = req.body;
    if (!period_month || !/^\d{4}-\d{2}$/.test(period_month)) {
        return res.status(400).json({ message: 'period_month is required as YYYY-MM' });
    }
    try {
        await periodLockService.lockPeriod({
            periodMonth: period_month,
            employeeId: req.user.employee_id,
            module: module || 'expenses'
        });
        res.status(200).json({ message: 'Period locked' });
    } catch (error) {
        console.error('Error locking period:', error);
        res.status(500).json({ message: 'Failed to lock period' });
    }
});

// POST /api/period-locks/unlock - Reopen a period. Requires a reason — this is
// the audited exception path, not a routine action.
router.post('/period-locks/unlock', protect, hasPermission('expenses:manage_periods'), async (req, res) => {
    const { period_month, reason, module } = req.body;
    if (!period_month || !/^\d{4}-\d{2}$/.test(period_month)) {
        return res.status(400).json({ message: 'period_month is required as YYYY-MM' });
    }
    try {
        await periodLockService.unlockPeriod({
            periodMonth: period_month,
            reason,
            employeeId: req.user.employee_id,
            module: module || 'expenses'
        });
        res.status(200).json({ message: 'Period reopened' });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error('Error unlocking period:', error);
        res.status(500).json({ message: 'Failed to reopen period' });
    }
});

module.exports = router;
