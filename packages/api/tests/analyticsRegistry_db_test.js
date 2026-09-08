// Real-database check that every registered metric's SQL parses and that every
// column it names actually exists. Excluded from the normal jest run (see
// jest.config.js testPathIgnorePatterns and the *_db_test.js convention) --
// run manually against a live DB:
//
//   docker exec forson_backend_dev node tests/analyticsRegistry_db_test.js
//
// This is the cheapest high-value test in the analytics module. Registry and
// schema drift apart silently: a renamed column breaks one metric, and without
// this you find out one tile at a time, in production, weeks later. EXPLAIN
// makes the database parse and plan the statement without executing it, so the
// whole registry is verified in well under a second.
//
// Everything runs inside a transaction that is rolled back, so it leaves no
// trace regardless of outcome.

const db = require('../db');
const { METRICS, DIMENSIONS, SOURCES } = require('../services/analytics/registry');
const { BOARDS } = require('../services/analytics/boards');
const { INSIGHT_RULES } = require('../services/analytics/registry/insights');
const { parseQueryRequest } = require('../services/analytics/requestValidator');
const { buildQuery } = require('../services/analytics/queryBuilder');

const ADMIN = { user: { employee_id: 0, permission_level_id: 10, permissions: [] } };
const RANGE = { from: '2025-01-01', to: '2026-12-31' };
// The named-account source refuses to build without it, which is the point of
// it. Supplied here, as the server does at runtime from the settings table, so
// this check covers those statements rather than skipping them; the id itself is
// irrelevant to whether the SQL parses.
const OPTS = { walkInCustomerId: 1 };

const failures = [];
const record = (label, err) => {
  failures.push(`${label}\n    ${err.message.split('\n')[0]}`);
};

async function explain(client, label, body) {
  let built;
  try {
    built = buildQuery(parseQueryRequest(body, ADMIN, OPTS));
  } catch (err) {
    record(`${label} (could not be built)`, err);
    return;
  }
  try {
    await client.query(`EXPLAIN ${built.text}`, built.values);
  } catch (err) {
    record(`${label} (database rejected the statement)`, err);
  }
}

async function run() {
  const client = await db.getClient();
  let checked = 0;
  try {
    await client.query('BEGIN READ ONLY');

    // 1. Every metric on its own, at the coarsest grain it supports.
    for (const metric of Object.values(METRICS)) {
      const grain = metric.grains.includes('none') ? null : metric.grains[metric.grains.length - 1];
      await explain(client, `metric ${metric.id}`, {
        metrics: [metric.id], grain, dateRange: RANGE,
      });
      checked += 1;
    }

    // 2. Every metric under every grain and every dimension its source supports.
    // This is where a dimension's join fragment gets exercised against the real
    // schema, which is the half of the registry unit tests cannot reach.
    for (const metric of Object.values(METRICS)) {
      if (!metric.source) continue;
      const src = SOURCES[metric.source];
      for (const dimId of src.dimensions) {
        if (dimId === 'date') continue;
        await explain(client, `metric ${metric.id} by ${dimId}`, {
          metrics: [metric.id], dimensions: [dimId], dateRange: RANGE,
        });
        checked += 1;
      }
      for (const grain of metric.grains) {
        if (grain === 'none') continue;
        await explain(client, `metric ${metric.id} by ${grain}`, {
          metrics: [metric.id], grain, dateRange: RANGE,
        });
        checked += 1;
      }
    }

    // 3. Every filterable dimension, as a filter.
    for (const dim of Object.values(DIMENSIONS)) {
      if (!dim.filterable) continue;
      const source = Object.values(SOURCES).find((s) => s.dimensions.includes(dim.id));
      const metric = Object.values(METRICS).find((m) => m.source === source.id);
      if (!metric) continue;
      const values = dim.valueType === 'int' ? [1, 2] : [dim.values ? dim.values[0] : 'x'];
      await explain(client, `filter on ${dim.id}`, {
        metrics: [metric.id], filters: { [dim.id]: values }, dateRange: RANGE,
      });
      checked += 1;
    }

    // 4. Every tile of every board, exactly as the frontend will ask for it.
    for (const board of Object.values(BOARDS)) {
      for (const tile of board.tiles) {
        // 'auto' is resolved on the client from the board's period, so check the
        // tile at every grain it could resolve to.
        const grains = tile.query.grain === 'auto'
          ? ['day', 'week', 'month', 'quarter']
          : [tile.query.grain ?? null];
        for (const grain of grains) {
          await explain(client, `board ${board.id} tile ${tile.id} (grain ${grain || 'none'})`, {
            ...tile.query, grain, minGrain: undefined, dateRange: RANGE,
          });
          checked += 1;
        }
      }
    }

    // 5. Comparison, both modes.
    for (const mode of ['previous_period', 'previous_year']) {
      await explain(client, `comparison ${mode}`, {
        metrics: ['sales.net_revenue', 'margin.gross_margin_pct'],
        dimensions: ['date'], grain: 'month', dateRange: RANGE, compare: mode,
      });
      checked += 1;
    }

    // 6. Every insight rule's own query, exactly as the panel asks for it.
    // A rule is prose, which a reader trusts more than a number, so a rule whose
    // query no longer parses must be a red run rather than a sentence that
    // quietly stops appearing.
    for (const rule of Object.values(INSIGHT_RULES)) {
      await explain(client, `insight ${rule.id}`, {
        metrics: [...rule.query.metrics],
        dimensions: [...(rule.query.dimensions || [])],
        grain: null,
        dateRange: RANGE,
        ...(rule.query.topN ? { topN: { ...rule.query.topN } } : {}),
        ...(rule.query.compare ? { compare: rule.query.compare } : {}),
      });
      checked += 1;
    }

    // 7. The named-account source with the setting absent. Every statement above
    // proves the SQL is right; this proves the refusal is, because the failure it
    // guards against -- counter trade silently counted as a customer -- looks
    // entirely plausible on screen.
    for (const metric of Object.values(METRICS)) {
      if (metric.source !== 'named_invoice') continue;
      let refused = false;
      try {
        buildQuery(parseQueryRequest({ metrics: [metric.id], dateRange: RANGE }, ADMIN));
      } catch (err) {
        refused = err.status === 409;
      }
      if (!refused) {
        failures.push(`metric ${metric.id} was built without the walk-in setting, silently including counter trade`);
      }
      checked += 1;
    }

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checked} analytics statements failed:\n`);
    failures.forEach((f) => console.error(`  - ${f}\n`));
    process.exitCode = 1;
    return;
  }
  console.log(`OK — ${checked} analytics statements parsed and planned against the live schema.`);
}

run()
  .catch((err) => {
    console.error('analyticsRegistry_db_test failed to run:', err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode || 0));
