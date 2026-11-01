const express = require('express');
const db = require('../db');
const { toDoc, syncApplications } = require('../meili-applications');
const router = express.Router();

// GET /api/application-search?q=...&limit=10
router.get('/application-search', async (req, res) => {
  const { q = '', limit = 10 } = req.query;
  try {
    const terms = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 12);
    const params = terms.map(term => `%${term}%`);
    const predicates = terms.map((_, i) => `concat_ws(' ',make,model,chassis,engine,year_start,year_end,market,variant_descriptor,drivetrain,transmission,generation,fuel_type,displacement_liters) ILIKE $${i + 1}`);
    params.push(Math.max(1, Math.min(parseInt(limit, 10) || 10, 50)));
    const { rows } = await db.query(`SELECT * FROM application_view ${predicates.length ? 'WHERE '+predicates.join(' AND ') : ''} ORDER BY make,model,engine,application_id LIMIT $${params.length}`, params);
    res.json(rows.map(toDoc));
  } catch (err) {
    console.error('Application search failed:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/reindex/applications — build the applications index from DB view
router.post('/reindex/applications', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM application_view');
    const docs = rows.map(toDoc);
    if (docs.length) await syncApplications(docs);
    res.json({ indexed: docs.length });
  } catch (err) {
    console.error('Applications reindex failed:', err.message);
    res.status(500).json({ error: 'Reindex failed' });
  }
});

module.exports = router;
