const express = require('express');
const db = require('../db');
const { index, toDoc, syncApplications } = require('../meili-applications');
const router = express.Router();

// GET /api/application-search?q=...&limit=10
router.get('/application-search', async (req, res) => {
  const { q = '', limit = 10 } = req.query;
  try {
    const searchRes = await index().search(q, { limit: Math.min(parseInt(limit, 10) || 10, 50) });
    res.json(searchRes.hits || []);
  } catch (err) {
    console.error('Application search failed:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/reindex/applications — build the applications index from DB view
router.post('/reindex/applications', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.application_id, a.make_id, a.model_id, a.engine_id,
             vmk.make_name AS make, vmd.model_name AS model, veng.engine_name AS engine
      FROM application a
      LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
      LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
      LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
    `);
    const docs = rows.map(toDoc);
    if (docs.length) await syncApplications(docs);
    res.json({ indexed: docs.length });
  } catch (err) {
    console.error('Applications reindex failed:', err.message);
    res.status(500).json({ error: 'Reindex failed' });
  }
});

module.exports = router;
