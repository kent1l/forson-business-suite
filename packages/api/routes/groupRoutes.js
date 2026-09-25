const express = require('express');
const db = require('../db');
const { generateUniqueCode } = require('../helpers/codeGenerator');
const { normalizeText } = require('../helpers/normalizeEntity');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const EntityMergeService = require('../services/entityMergeService');
const router = express.Router();
const mergeService = new EntityMergeService(db, 'group');

// GET all groups
router.get('/groups', protect, async (req, res) => {
  try {
    res.json(await mergeService.list());
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new group - generate code if not supplied
router.post('/groups', protect, hasPermission(['groups:manage', 'parts:create']), async (req, res) => {
  const group_name = normalizeText(req.body.group_name);
  const { group_code } = req.body;
  if (!group_name) {
    return res.status(400).json({ message: 'Group name is required.' });
  }

  const client = await db.getClient();
  try {
    let codeToUse = group_code && group_code.trim() !== '' ? group_code.trim().toUpperCase() : null;
    if (!codeToUse) {
      codeToUse = await generateUniqueCode(client, group_name, 'group', 'group_code');
    }

    const insertRes = await client.query(
      'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING *',
      [group_name, codeToUse]
    );
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

router.put('/groups/bulk', protect, hasPermission('groups:manage'), async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!updates.length) return res.status(400).json({ message: 'updates must contain at least one change.' });
    const results = await Promise.all(updates.map(({ group_id, ...values }) => mergeService.update(group_id, values)));
    res.json({ success: true, groups: results });
  } catch (err) { res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({ message: err.message || 'Unable to update groups.' }); }
});
router.put('/groups/:id', protect, hasPermission('groups:manage'), async (req, res) => {
  try { res.json({ success: true, group: await mergeService.update(req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({ message: err.message || 'Unable to update group.' }); }
});
router.post('/groups/scan-duplicates', protect, hasPermission('groups:manage'), async (req, res) => {
  try { res.json({ success: true, ...(await mergeService.scan(req.body || {})) }); }
  catch (err) { console.error('Group duplicate scan failed:', err); res.status(500).json({ message: 'Unable to scan groups.' }); }
});
router.get('/groups/duplicate-suggestions', protect, hasPermission('groups:manage'), async (_req, res) => {
  try { res.json({ success: true, suggestions: await mergeService.suggestions() }); }
  catch { res.status(500).json({ message: 'Unable to load group suggestions.' }); }
});
router.post('/groups/merge-preview', protect, hasPermission('groups:manage'), async (req, res) => {
  try { res.json({ success: true, ...(await mergeService.preview(req.body || {})) }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to preview group merge.' }); }
});
router.post('/groups/merge', protect, hasPermission('groups:manage'), async (req, res) => {
  try { res.json({ success: true, result: await mergeService.execute(req.body || {}, req.user.employee_id) }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to merge groups.' }); }
});
router.post('/groups/duplicate-suggestions/:id/dismiss', protect, hasPermission('groups:manage'), async (req, res) => {
  try { await mergeService.dismiss(req.params.id, req.user.employee_id); res.json({ success: true }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to dismiss suggestion.' }); }
});

module.exports = router;
