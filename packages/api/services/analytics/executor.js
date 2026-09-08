const db = require('../../db');
const { AnalyticsRequestError } = require('./errors');
const { FORMATS } = require('./registry');

/**
 * Query execution.
 *
 * Two properties matter more than anything else in this file, and both exist to
 * protect the counter rather than the dashboard.
 *
 * 1. `SET LOCAL statement_timeout`. There is no statement_timeout anywhere in
 *    this codebase today, so one bad exploratory query can pin a pool connection
 *    indefinitely. Setting it on the pool in db.js was NOT an option: that pool
 *    is shared with goods-receipt posting, backups, the dedupe scan worker, the
 *    Meili outbox workers and payroll, and a pool-wide timeout would be a silent
 *    behavioural change to every one of them. SET LOCAL reverts on COMMIT or
 *    ROLLBACK, so the pooled connection is never left polluted.
 *
 * 2. A concurrency semaphore. POS must never stall because someone opened a
 *    dashboard. Four analytics queries at a time, a bounded queue behind them,
 *    and a 503 rather than an unbounded backlog.
 *
 * READ ONLY makes a write from an analytics bug impossible at the database
 * level. REPEATABLE READ plus running a batch's queries serially on one client
 * gives every tile on a board the same snapshot, which is what stops a KPI card
 * and the chart beneath it disagreeing.
 */

const MAX_CONCURRENT = 4;
const MAX_QUEUE_DEPTH = 20;

// The timeout is interpolated into a SET LOCAL, which takes no parameters, so it
// is clamped to an integer in a sane range here rather than trusted from the
// caller. No request path reaches it today; this keeps that true if one ever does.
const clampTimeout = (ms) => {
    const n = Math.trunc(Number(ms));
    return Number.isFinite(n) ? Math.min(Math.max(n, 1000), 30000) : 8000;
};

let active = 0;
const waiting = [];

const acquire = () => new Promise((resolve) => {
    if (active < MAX_CONCURRENT) {
        active += 1;
        resolve();
        return;
    }
    if (waiting.length >= MAX_QUEUE_DEPTH) {
        throw new AnalyticsRequestError(503, 'Analytics is busy right now. Please try again in a moment.');
    }
    waiting.push(resolve);
});

const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
};

/**
 * Run one or more prepared statements on a single connection, inside one
 * read-only repeatable-read transaction.
 */
async function executeAll(statements, { timeoutMs = 8000 } = {}) {
    await acquire();
    // Checking out the connection is inside the guarded region: if getClient()
    // rejects, the permit has to come back, or a handful of pool failures wedge
    // analytics at 503 until the process restarts.
    let client;
    try {
        client = await db.getClient();
    } catch (err) {
        release();
        throw err;
    }
    try {
        await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
        await client.query(`SET LOCAL statement_timeout = ${clampTimeout(timeoutMs)}`);
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 15000');
        const results = [];
        for (const stmt of statements) {
            // Serial, not parallel: they share one client and therefore one snapshot.
            // At tens of milliseconds each this is imperceptible and worth far more
            // than the parallelism.
            // eslint-disable-next-line no-await-in-loop
            results.push(await client.query(stmt.text, stmt.values));
        }
        await client.query('COMMIT');
        return results;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        release();
    }
}

/**
 * Coerce a result row once, centrally, driven by the registry's declared
 * formats -- replacing the per-route parseFloat sprinkling that lets one report
 * return a string where another returns a number.
 *
 * NULL stays NULL. It means "not measured", which is a different statement from
 * zero and the UI renders it differently.
 */
function coerceRows(rows, columnMap) {
    return rows.map((row) => {
        const out = {};
        for (const [col, value] of Object.entries(row)) {
            const meta = columnMap[col];
            if (value === null || value === undefined) {
                out[col] = null;
            } else if (!meta) {
                out[col] = value;
            } else if (meta.kind === 'metric') {
                out[col] = FORMATS[meta.format] && FORMATS[meta.format].numeric ? Number(value) : value;
            } else if (meta.kind === 'coverage' || meta.kind === 'bucket') {
                out[col] = Number(value);
            } else if (meta.kind === 'dimension_label') {
                out[col] = String(value);
            } else {
                out[col] = value;
            }
        }
        return out;
    });
}

module.exports = { executeAll, coerceRows, MAX_CONCURRENT, MAX_QUEUE_DEPTH };
