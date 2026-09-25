const express = require('express');
const db = require('../db');
const { generateUniqueCode } = require('../helpers/codeGenerator');
const { normalizeText } = require('../helpers/normalizeEntity');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const EntityMergeService = require('../services/entityMergeService');
const router = express.Router();
const mergeService = new EntityMergeService(db, 'brand');

// GET all brands
router.get('/brands', protect, async (req, res) => {
  try {
    res.json(await mergeService.list());
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// POST a new brand - if brand_code is not provided, generate one using helper
router.post('/brands', protect, hasPermission(['brands:manage', 'parts:create']), async (req, res) => {
  const brand_name = normalizeText(req.body.brand_name);
  const { brand_code } = req.body;
  if (!brand_name) {
    return res.status(400).json({ message: 'Brand name is required.' });
  }

  const client = await db.getClient();
  try {
    // If no brand_code supplied, generate a unique code using helper which needs a client
    let codeToUse = brand_code && brand_code.trim() !== '' ? brand_code.trim().toUpperCase() : null;
    if (!codeToUse) {
      codeToUse = await generateUniqueCode(client, brand_name, 'brand', 'brand_code');
    }

    const insertRes = await client.query(
      'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING *',
      [brand_name, codeToUse]
    );
    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

router.put('/brands/bulk', protect, hasPermission('brands:manage'), async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    if (!updates.length) return res.status(400).json({ message: 'updates must contain at least one change.' });
    const results = await Promise.all(updates.map(({ brand_id, ...values }) => mergeService.update(brand_id, values)));
    res.json({ success: true, brands: results });
  } catch (err) {
    res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({ message: err.message || 'Unable to update brands.' });
  }
});

router.put('/brands/:id', protect, hasPermission('brands:manage'), async (req, res) => {
  try { res.json({ success: true, brand: await mergeService.update(req.params.id, req.body || {}) }); }
  catch (err) { res.status(err.statusCode || (err.code === '23505' ? 409 : 500)).json({ message: err.message || 'Unable to update brand.' }); }
});

router.post('/brands/scan-duplicates', protect, hasPermission('brands:manage'), async (req, res) => {
  try { res.json({ success: true, ...(await mergeService.scan(req.body || {})) }); }
  catch (err) { console.error('Brand duplicate scan failed:', err); res.status(500).json({ message: 'Unable to scan brands.' }); }
});
router.get('/brands/duplicate-suggestions', protect, hasPermission('brands:manage'), async (_req, res) => {
  try { res.json({ success: true, suggestions: await mergeService.suggestions() }); }
  catch (_err) { res.status(500).json({ message: 'Unable to load brand suggestions.' }); }
});
router.post('/brands/merge-preview', protect, hasPermission('brands:manage'), async (req, res) => {
  try { res.json({ success: true, ...(await mergeService.preview(req.body || {})) }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to preview brand merge.' }); }
});
router.post('/brands/merge', protect, hasPermission('brands:manage'), async (req, res) => {
  try { res.json({ success: true, result: await mergeService.execute(req.body || {}, req.user.employee_id) }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to merge brands.' }); }
});
router.post('/brands/duplicate-suggestions/:id/dismiss', protect, hasPermission('brands:manage'), async (req, res) => {
  try { await mergeService.dismiss(req.params.id, req.user.employee_id); res.json({ success: true }); }
  catch (err) { res.status(err.statusCode || 500).json({ message: err.message || 'Unable to dismiss suggestion.' }); }
});

module.exports = router;
