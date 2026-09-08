const express = require('express');
const { Parser } = require('json2csv');
const { protect, hasPermission, userHasPermission } = require('../middleware/authMiddleware');
const analytics = require('../services/analytics');
const { AnalyticsRequestError } = require('../services/analytics/errors');
const { METRICS, REGISTRY_VERSION } = require('../services/analytics/registry');

const router = express.Router();

/**
 * HTTP surface for the analytics module.
 *
 * /batch is load-bearing rather than an optimisation. `protect` performs a JWT
 * verify AND a joined query against employee/role_permission/permission on
 * every request, so a 12-tile board rendered as 12 requests costs 12 extra auth
 * queries and 12 pool checkouts before any analytics work begins.
 */

const respondToError = (res, err, context) => {
    if (err instanceof AnalyticsRequestError) {
        return res.status(err.status).json({ message: err.message, details: err.details || undefined });
    }
    // A statement_timeout kill arrives as a plain pg error; say what happened
    // rather than "internal error", because the fix is the user's (narrow the range).
    if (err && err.code === '57014') {
        return res.status(504).json({ message: 'That query took too long. Try a shorter date range or fewer breakdowns.' });
    }
    console.error(`Analytics ${context} failed:`, err && err.stack ? err.stack : err);
    return res.status(500).json({ message: `Failed to ${context}.` });
};

// GET /api/analytics/meta
router.get('/analytics/meta', protect, hasPermission('analytics:view'), async (req, res) => {
    try {
        const meta = await analytics.getMeta(req, { fresh: req.query.fresh === '1' });
        // The registry version plus this user's visible metric set: two users with
        // different permissions must never share a cached /meta.
        res.set('ETag', `W/"${REGISTRY_VERSION}-${meta.metrics.length}-${meta.permissions.financials ? 1 : 0}"`);
        res.set('Cache-Control', 'private, max-age=300');
        res.json(meta);
    } catch (err) {
        respondToError(res, err, 'load analytics metadata');
    }
});

// GET /api/analytics/boards
router.get('/analytics/boards', protect, hasPermission('analytics:view'), (req, res) => {
    try {
        res.json(analytics.listBoards(req));
    } catch (err) {
        respondToError(res, err, 'list analytics boards');
    }
});

// GET /api/analytics/boards/:id
router.get('/analytics/boards/:id', protect, hasPermission('analytics:view'), (req, res) => {
    try {
        res.json(analytics.getBoard(req.params.id, req));
    } catch (err) {
        respondToError(res, err, 'load the analytics board');
    }
});

// GET /api/analytics/insights/:boardId
//
// Deterministic rules only (PRD §14). Nothing here is generated: the response
// carries a template declared in the registry, the typed values substituted into
// it, and the metric ids each sentence was derived from, so the frontend formats
// the numbers exactly as the tiles do and a reader can follow the citation.
router.get('/analytics/insights/:boardId', protect, hasPermission('analytics:view'), async (req, res) => {
    try {
        const preset = req.query.preset ? String(req.query.preset) : null;
        const dateRange = preset
            ? { preset }
            : { from: String(req.query.from || ''), to: String(req.query.to || '') };
        const result = await analytics.getInsights({
            boardId: req.params.boardId,
            dateRange,
            compare: req.query.compare !== '0',
        }, req);
        if (result.failed) {
            // Not an empty panel: every rule's query failed, and "nothing stands
            // out" would be a reassuring lie.
            return res.status(502).json({ message: 'Could not work out the insights for this board.' });
        }
        return res.json(result);
    } catch (err) {
        return respondToError(res, err, 'work out the insights for this board');
    }
});

// POST /api/analytics/query
router.post('/analytics/query', protect, hasPermission('analytics:view'), async (req, res) => {
    const wantsCsv = req.body && req.body.format === 'csv';

    if (req.query.explain === '1') {
        // Reading the generated SQL is an admin diagnostic, not a user feature.
        if (!userHasPermission(req, 'analytics:view') || Number(req.user.permission_level_id) !== 10) {
            return res.status(403).json({ message: 'Only an administrator may inspect the generated query.' });
        }
        try {
            return res.json(await analytics.explainQuery(req.body, req));
        } catch (err) {
            return respondToError(res, err, 'explain the analytics query');
        }
    }

    if (wantsCsv && !userHasPermission(req, 'analytics:export')) {
        return res.status(403).json({ message: 'You do not have permission to export analytics data.' });
    }

    try {
        const result = await analytics.runQuery(req.body, req, {
            forCsv: wantsCsv,
            fresh: req.query.fresh === '1',
        });

        if (!wantsCsv) return res.json(result);

        const flat = flattenForCsv(result);
        const csv = new Parser().parse(flat);
        res.header('Content-Type', 'text/csv');
        res.attachment('analytics-export.csv');
        return res.send(csv);
    } catch (err) {
        return respondToError(res, err, 'run the analytics query');
    }
});

// POST /api/analytics/batch
router.post('/analytics/batch', protect, hasPermission('analytics:view'), async (req, res) => {
    const queries = (req.body && req.body.queries) || [];
    if (!Array.isArray(queries) || queries.length === 0) {
        return res.status(400).json({ message: 'A batch needs at least one query.' });
    }
    if (queries.length > analytics.BUDGET.maxBatchQueries) {
        return res.status(400).json({
            message: `A batch may carry at most ${analytics.BUDGET.maxBatchQueries} queries; this one carried ${queries.length}.`,
        });
    }

    try {
        const outcomes = await analytics.runBatch(
            queries.map((q, i) => ({ key: String(q.key ?? i), body: q })),
            req,
            { fresh: req.query.fresh === '1' }
        );

        const results = {};
        for (const outcome of outcomes) {
            // Partial failure is per key. One bad tile must not blank a board.
            results[outcome.key] = outcome.error
                ? {
                    error: {
                        status: outcome.error instanceof AnalyticsRequestError ? outcome.error.status : 500,
                        message: outcome.error instanceof AnalyticsRequestError
                            ? outcome.error.message
                            : 'Failed to run this query.',
                        details: outcome.error instanceof AnalyticsRequestError ? outcome.error.details : undefined,
                    },
                }
                : outcome.result;
            if (outcome.error && !(outcome.error instanceof AnalyticsRequestError)) {
                console.error('Analytics batch entry failed:', outcome.error.stack || outcome.error);
            }
        }
        return res.json({ results });
    } catch (err) {
        return respondToError(res, err, 'run the analytics batch');
    }
});

/**
 * One flat row per result row, with the coverage a figure was measured over
 * carried alongside it. An export that drops the coverage is an export of
 * numbers that look more certain than they are.
 */
function flattenForCsv(result) {
    return result.rows.map((row) => {
        const out = {};
        row.dimensions.forEach((d) => { out[d.id] = d.label; });
        for (const [metricId, value] of Object.entries(row.values)) {
            out[METRICS[metricId] ? METRICS[metricId].label : metricId] = value;
        }
        for (const [rule, cov] of Object.entries(row.coverage || {})) {
            out[`${rule}_coverage_pct`] = cov.denValue > 0
                ? Math.round(cov.valueRatio * 1000) / 10
                : null;
        }
        return out;
    });
}

module.exports = router;
