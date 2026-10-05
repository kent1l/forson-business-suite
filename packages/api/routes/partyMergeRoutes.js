const express = require('express');
const PartyMergeService = require('../services/partyMergeService');

module.exports = function partyMergeRoutes(db, party) {
    const router = express.Router();
    const service = new PartyMergeService(db, party);
    const plural = `${party}s`;
    const permission = party === 'customer' ? 'customers:edit' : 'suppliers:edit';
    const { protect, hasPermission } = require('../middleware/authMiddleware');

    router.get(`/${plural}/merge-directory`, protect, hasPermission(permission), async (_req, res) => {
        try { res.json({ items: await service.list() }); }
        catch { res.status(500).json({ message: `Unable to load ${plural} for merge review.` }); }
    });
    router.post(`/${plural}/scan-duplicates`, protect, hasPermission(permission), async (req, res) => {
        try { res.json({ success: true, ...(await service.scan(req.body || {})) }); }
        catch (error) { console.error(`${party} duplicate scan failed:`, error); res.status(500).json({ message: `Unable to scan ${plural}.` }); }
    });
    router.get(`/${plural}/duplicate-suggestions`, protect, hasPermission(permission), async (_req, res) => {
        try { res.json({ suggestions: await service.suggestions() }); }
        catch { res.status(500).json({ message: `Unable to load ${party} suggestions.` }); }
    });
    router.post(`/${plural}/merge-preview`, protect, hasPermission(permission), async (req, res) => {
        try { res.json(await service.preview(req.body || {}, req.user.employee_id)); }
        catch (error) { res.status(error.statusCode || 500).json({ message: error.message || `Unable to preview ${party} merge.` }); }
    });
    router.get(`/${plural}/merge-history`, protect, hasPermission(permission), async (req, res) => {
        try { res.json({ operations: await service.history(req.query.limit) }); }
        catch (error) { res.status(error.statusCode || 500).json({ message: error.message || 'Unable to load merge history.' }); }
    });
    router.post(`/${plural}/merge`, protect, hasPermission(permission), async (req, res) => {
        try { res.json({ result: await service.execute(req.body || {}, req.user.employee_id) }); }
        catch (error) { res.status(error.statusCode || 500).json({ message: error.message || `Unable to merge ${plural}.`, blockers: error.blockers || [] }); }
    });
    router.post(`/${plural}/duplicate-suggestions/:id/dismiss`, protect, hasPermission(permission), async (req, res) => {
        try { await service.dismiss(req.params.id, req.user.employee_id); res.json({ success: true }); }
        catch (error) { res.status(error.statusCode || 500).json({ message: error.message || 'Unable to dismiss suggestion.' }); }
    });
    return router;
};
