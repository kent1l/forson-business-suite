const crypto = require('crypto');
const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');
const { FORMATS } = require('./formats');
const { TRUST_RULES } = require('./trust');
const { READINESS_PROBES } = require('./readiness');
const { SOURCES, resolveJoins } = require('./sources');
const { DIMENSIONS, GRAINS, GRAIN_KEYS } = require('./dimensions');
const { METRIC_SOURCE_FILES } = require('./metrics');

/**
 * The registry: assembled, cross-validated, and deep-frozen at require() time.
 *
 * Every failure in here throws while the module is loading, which means the
 * server refuses to boot rather than serving one broken tile in production. A
 * metric that names a renamed column, a board that cites a deleted metric, a
 * ratio that references itself -- all of them become a startup crash and a red
 * test run instead of a support ticket six weeks later.
 *
 * Deep-freezing is also the first line of the injection defence (§7.5 of the
 * PRD): the query builder only ever interpolates values it read out of this
 * object, and nothing at runtime can put a caller's string into it.
 */

const KINDS = new Set(['additive', 'snapshot', 'composite', 'ratio']);

// The permission every analytics caller already holds. Anything else is a
// narrower grant on top of it, which is what lets the composite check below
// reason about "at least as restricted as".
const BASE_PERMISSION = 'analytics:view';
const DIRECTIONS = new Set(['higher_is_better', 'lower_is_better', 'neutral']);

const deepFreeze = (value, seen = new WeakSet()) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (seen.has(value)) return value;
    seen.add(value);
    Object.getOwnPropertyNames(value).forEach((key) => {
        // Reading a function's own `caller`/`arguments` throws in strict mode.
        if (typeof value === 'function' && (key === 'caller' || key === 'arguments')) return;
        deepFreeze(value[key], seen);
    });
    return Object.freeze(value);
};

const fail = (message) => {
    throw new AnalyticsRegistryError(`Analytics registry: ${message}`);
};

// ---------------------------------------------------------------------------
// Assemble metrics
// ---------------------------------------------------------------------------

const METRICS = {};
for (const [file, group] of METRIC_SOURCE_FILES) {
    for (const [key, metric] of Object.entries(group)) {
        if (key !== metric.id) fail(`metric key '${key}' in ${file}.js does not match its id '${metric.id}'`);
        if (METRICS[key]) fail(`metric id '${key}' is declared twice (second in ${file}.js)`);
        METRICS[key] = metric;
    }
}

// ---------------------------------------------------------------------------
// Validate sources and dimensions
// ---------------------------------------------------------------------------

for (const [id, src] of Object.entries(SOURCES)) {
    if (id !== src.id) fail(`source key '${id}' does not match its id '${src.id}'`);
    if (typeof src.from !== 'string' || !src.from.trim()) fail(`source '${id}' has no FROM clause`);
    if (typeof src.defaultWhere !== 'function') fail(`source '${id}' has no defaultWhere function`);
    if (!src.cols || typeof src.cols !== 'object') fail(`source '${id}' has no cols map`);

    for (const dimId of src.dimensions) {
        const dim = DIMENSIONS[dimId];
        if (!dim) fail(`source '${id}' lists unknown dimension '${dimId}'`);
        if (dimId === 'date' && !src.dateColumn) {
            fail(`source '${id}' lists the 'date' dimension but has no dateColumn`);
        }
        try {
            resolveJoins(src, dim.requiresJoins);
        } catch (err) {
            fail(`dimension '${dimId}' is unreachable from source '${id}': ${err.message}`);
        }
        // Prove the expressions render against this source's real column map.
        const ctx = { grainUnit: 'month', dateFormat: 'YYYY-MM' };
        for (const fn of ['key', 'keyLabel']) {
            const sql = String(dim[fn](src.cols, src, ctx));
            if (sql.includes('undefined')) {
                fail(`dimension '${dimId}'.${fn} renders 'undefined' against source '${id}' — a column name is wrong`);
            }
            if (sql.includes('$')) {
                fail(`dimension '${dimId}'.${fn} contains a placeholder; registry SQL must never carry request values`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Validate metrics
// ---------------------------------------------------------------------------

const metricOrFail = (id, context) => {
    if (!Object.prototype.hasOwnProperty.call(METRICS, id)) {
        fail(`${context} references unknown metric '${id}'`);
    }
    return METRICS[id];
};

for (const [id, m] of Object.entries(METRICS)) {
    if (!KINDS.has(m.kind)) fail(`metric '${id}' has unknown kind '${m.kind}'`);
    if (!FORMATS[m.format]) fail(`metric '${id}' has unknown format '${m.format}'`);
    if (!DIRECTIONS.has(m.direction)) fail(`metric '${id}' has unknown direction '${m.direction}'`);
    if (!m.label || !m.description) fail(`metric '${id}' must carry a label and a plain-language description`);
    if (!m.permission) fail(`metric '${id}' must declare a permission`);
    if (!Array.isArray(m.grains) || m.grains.length === 0) fail(`metric '${id}' declares no grains`);
    for (const g of m.grains) {
        if (!GRAIN_KEYS.includes(g)) fail(`metric '${id}' declares unknown grain '${g}'`);
    }
    if (m.readiness && !READINESS_PROBES[m.readiness]) {
        fail(`metric '${id}' references unknown readiness probe '${m.readiness}'`);
    }

    if (m.kind === 'additive' || m.kind === 'snapshot') {
        const src = SOURCES[m.source];
        if (!src) fail(`metric '${id}' references unknown source '${m.source}'`);
        if (typeof m.expr !== 'function') fail(`metric '${id}' has no expr function`);
        if (m.where !== undefined && typeof m.where !== 'function') {
            fail(`metric '${id}'.where must be a function of the source's cols`);
        }
        for (const fn of ['expr', 'where']) {
            if (!m[fn]) continue;
            const sql = String(m[fn](src.cols));
            if (sql.includes('undefined')) {
                fail(`metric '${id}'.${fn} renders 'undefined' — it names a column source '${m.source}' does not have`);
            }
            if (sql.includes('$')) {
                fail(`metric '${id}'.${fn} contains a placeholder; registry SQL must never carry request values`);
            }
        }
        // `expr` must be a bare aggregate: the builder owns FILTER and COALESCE, so
        // that a trust rule cannot be placed wrongly or left off by a metric author.
        if (/\bFILTER\s*\(/i.test(String(m.expr(src.cols)))) {
            fail(`metric '${id}'.expr contains its own FILTER; declare a \`where\` function instead so the builder can combine it with the trust rule`);
        }
        if (m.kind === 'snapshot' && (m.grains.length !== 1 || m.grains[0] !== 'none')) {
            // A point-in-time figure under a month grain repeats today's value on
            // every row. It looks like a flat trend and is simply wrong.
            fail(`snapshot metric '${id}' must declare grains: ['none']`);
        }
        if (m.trust) {
            const rule = TRUST_RULES[m.trust];
            if (!rule) fail(`metric '${id}' references unknown trust rule '${m.trust}'`);
            for (const fn of ['predicate', 'weight', 'scope']) {
                if (!rule[fn]) continue;
                const out = String(rule[fn](src.cols));
                if (out.includes('undefined')) {
                    fail(`trust rule '${m.trust}'.${fn} renders 'undefined' against source '${m.source}' (used by '${id}')`);
                }
            }
        }
    } else if (m.kind === 'composite') {
        if (!Array.isArray(m.terms) || m.terms.length === 0) fail(`composite metric '${id}' has no terms`);
        for (const t of m.terms) {
            if (t.sign !== 1 && t.sign !== -1) fail(`composite metric '${id}' has a term with sign '${t.sign}'`);
            metricOrFail(t.metric, `composite metric '${id}'`);
        }
    } else if (m.kind === 'ratio') {
        metricOrFail(m.numerator, `ratio metric '${id}' numerator`);
        metricOrFail(m.denominator, `ratio metric '${id}' denominator`);
        if (m.scale !== undefined && typeof m.scale !== 'number'
            && !(m.scale && typeof m.scale.context === 'string')) {
            fail(`ratio metric '${id}' has an unusable scale`);
        }
    }
}

// ---------------------------------------------------------------------------
// Resolve the derivation graph once, at load: cycles and grain conflicts
// become boot failures instead of query-time failures.
// ---------------------------------------------------------------------------

const LEAVES = new Map();      // metric id -> ordered leaf metric ids
const DEPENDS_ON = new Map();  // metric id -> ordered derived-metric ids it needs, deepest first

const resolveGraph = (id, stack) => {
    if (LEAVES.has(id)) return;
    if (stack.includes(id)) fail(`metric '${id}' takes part in a cycle: ${[...stack, id].join(' -> ')}`);

    const m = METRICS[id];
    if (m.kind === 'additive' || m.kind === 'snapshot') {
        LEAVES.set(id, [id]);
        DEPENDS_ON.set(id, []);
        return;
    }

    const children = m.kind === 'composite'
        ? m.terms.map((t) => t.metric)
        : [m.numerator, m.denominator];

    const leaves = [];
    const deps = [];
    for (const childId of children) {
        resolveGraph(childId, [...stack, id]);
        for (const leaf of LEAVES.get(childId)) if (!leaves.includes(leaf)) leaves.push(leaf);
        for (const dep of DEPENDS_ON.get(childId)) if (!deps.includes(dep)) deps.push(dep);
        if (METRICS[childId].kind === 'composite' || METRICS[childId].kind === 'ratio') {
            if (!deps.includes(childId)) deps.push(childId);
        }
    }
    LEAVES.set(id, leaves);
    DEPENDS_ON.set(id, deps);
};

for (const id of Object.keys(METRICS)) resolveGraph(id, []);

// A derived metric must be at least as restricted as everything it is computed
// from. Without this, a metric visible under `analytics:view` whose component
// required `analytics:financials` would hand that component's value back as an
// exposed composite term -- the permission check runs on what was asked for, not
// on what the answer is made of.
for (const [id, leafIds] of LEAVES.entries()) {
    const m = METRICS[id];
    if (m.kind === 'additive' || m.kind === 'snapshot') continue;
    for (const leafId of leafIds) {
        const leaf = METRICS[leafId];
        if (leaf.permission !== m.permission && leaf.permission !== BASE_PERMISSION) {
            fail(`metric '${id}' is visible under '${m.permission}' but is computed from '${leafId}', which requires '${leaf.permission}'`);
        }
    }
}

// A derived metric can only be offered at a grain every one of its leaves
// supports. Without this, a ratio over a snapshot would advertise a monthly
// breakdown it cannot honestly produce.
for (const [id, leafIds] of LEAVES.entries()) {
    const m = METRICS[id];
    if (m.kind === 'additive' || m.kind === 'snapshot') continue;
    for (const grain of m.grains) {
        for (const leafId of leafIds) {
            if (!METRICS[leafId].grains.includes(grain)) {
                fail(`metric '${id}' declares grain '${grain}' but its component '${leafId}' does not support it`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

const REGISTRY_VERSION = crypto.createHash('sha256')
    .update(JSON.stringify({
        metrics: Object.keys(METRICS).sort(),
        sources: Object.keys(SOURCES).sort(),
        dimensions: Object.keys(DIMENSIONS).sort(),
        grains: Object.keys(GRAINS).sort(),
        trust: Object.keys(TRUST_RULES).sort(),
    }))
    .digest('hex')
    .slice(0, 16);

/**
 * Resolve an id a caller supplied against a registry map.
 *
 * `hasOwnProperty` rather than `in`, so `__proto__` and `constructor` resolve to
 * nothing instead of to Object.prototype members. The 400 lists valid ids
 * because the caller cannot see the registry and has no other way to correct.
 */
const mustResolve = (map, id, kind) => {
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(map, id)) {
        throw new AnalyticsRequestError(400, `Unknown ${kind}: ${JSON.stringify(id)}`, {
            kind,
            received: typeof id === 'string' ? id : String(id),
            valid: Object.keys(map),
        });
    }
    return map[id];
};

const leavesOf = (metricId) => LEAVES.get(metricId) || [];
const dependenciesOf = (metricId) => DEPENDS_ON.get(metricId) || [];

deepFreeze(METRICS);

module.exports = {
    METRICS,
    SOURCES,
    DIMENSIONS,
    GRAINS,
    GRAIN_KEYS,
    FORMATS,
    TRUST_RULES,
    READINESS_PROBES,
    REGISTRY_VERSION,
    mustResolve,
    leavesOf,
    dependenciesOf,
};
