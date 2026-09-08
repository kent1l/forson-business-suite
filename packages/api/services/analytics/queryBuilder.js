const { AnalyticsRequestError } = require('./errors');
const {
    METRICS, SOURCES, GRAINS, TRUST_RULES, leavesOf,
} = require('./registry');
const { resolveJoins } = require('./registry/sources');

/**
 * buildQuery(spec) -> { text, values, plan }
 *
 * The one genuinely hard piece. It takes a fully resolved spec -- registry
 * objects, never ids the caller typed -- and produces a single parameterised
 * statement.
 *
 * THE INVARIANT (PRD §7.5): no byte of `text` originates from the request.
 * Every fragment is either a literal in this file or a value read out of the
 * deep-frozen registry via a key `requestValidator.js` resolved by exact match.
 * Every request value appears only in `values`. Metric and dimension SQL is
 * produced by functions that receive the source's frozen `cols` map and nothing
 * else, so they are structurally incapable of carrying caller input.
 *
 * The shape is always the same:
 *   1. one CTE per fact source in play, each aggregated to the requested keys;
 *   2. a UNION of those CTEs' keys, if there is more than one source;
 *   3. a LEFT JOIN of each source back onto that key set;
 *   4. optionally, a top-N stage that ranks the categories and folds the tail
 *      into a single 'Other' row;
 *   5. a final SELECT that computes composites, ratios and coverage ratios
 *      *after* aggregation.
 *
 * Step 1 is why refunds are safe. Sales and credit notes are different sources
 * with different date columns, so there is no code path here that puts them in
 * the same FROM clause. The separation the tax-report incident had to be fixed
 * into by hand falls out of the architecture instead.
 */

const MANILA = "AT TIME ZONE 'Asia/Manila'";

/**
 * Flags the folded tail row. The label alone cannot carry this: a brand that is
 * genuinely called "Other" and the rollup bucket must be distinguishable, and so
 * must a NULL key that means "(No brand)" from a NULL key that means "the other
 * four hundred brands".
 */
const ROLLUP_COLUMN = 'is_other';

/**
 * How many categories a row stands for: 1 for a kept row, and the size of the
 * tail on the folded one. "Other — 436 more brands" is a different statement
 * from an unlabelled grey bar, and it is the only thing on screen that says how
 * much of the catalogue the chart is not naming.
 */
const ROLLUP_COUNT_COLUMN = 'rollup_count';

const manilaDate = (col) => `(${col} ${MANILA})::date`;

const arrayCast = (valueType) => (valueType === 'int' ? '::int[]' : '::text[]');

/** Literal for a ratio's zero-denominator fallback. Registry-sourced, never caller input. */
const zeroDenominatorLiteral = (metric) => {
    const v = metric.zeroDenominator;
    if (v === undefined || v === null) return 'NULL::numeric';
    if (typeof v === 'number' && Number.isFinite(v)) return `${v}::numeric`;
    throw new AnalyticsRequestError(500, `Metric '${metric.id}' has an unusable zeroDenominator.`);
};

function buildQuery(spec) {
    const values = [];
    /** Push a value and get back its placeholder. The only way a request value enters the SQL. */
    const P = (v) => `$${values.push(v)}`;

    const grainDef = spec.grain ? GRAINS[spec.grain] : null;
    const grainCtx = grainDef
        ? { grainUnit: grainDef.unit, dateFormat: grainDef.dateFormat }
        : { grainUnit: 'month', dateFormat: 'YYYY-MM' };

    // --- parameters shared by every source CTE.
    // Allocated lazily and memoised: a query made entirely of snapshot metrics
    // never mentions a date, and pg rejects a statement that is handed a
    // parameter its text never uses ("could not determine data type of
    // parameter $1"). Memoising keeps one placeholder per value across every
    // CTE that does use it.
    const once = (fn) => { let held; let taken = false; return () => { if (!taken) { held = fn(); taken = true; } return held; }; };
    const pFrom = once(() => P(spec.dateRange.from));
    const pTo = once(() => P(spec.dateRange.to));
    const pCmpFrom = once(() => (spec.compare ? P(spec.compare.dateRange.from) : null));
    const pCmpTo = once(() => (spec.compare ? P(spec.compare.dateRange.to) : null));

    const filterPlaceholders = new Map();
    for (const f of spec.filters) {
        filterPlaceholders.set(f.dimension.id, once(() => P(f.values)));
    }

    // --- step 1: expand derived metrics down to their leaves ----------------
    const leafIds = [];
    for (const m of spec.metrics) {
        for (const leaf of leavesOf(m.id)) if (!leafIds.includes(leaf)) leafIds.push(leaf);
    }
    const leafColumn = new Map(leafIds.map((id, i) => [id, `m_${i}`]));

    // --- step 2: group leaves by source -------------------------------------
    const bySource = new Map();
    for (const id of leafIds) {
        const sourceId = METRICS[id].source;
        if (!bySource.has(sourceId)) bySource.set(sourceId, []);
        bySource.get(sourceId).push(METRICS[id]);
    }
    const sourceIds = [...bySource.keys()];

    // --- step 3: validate the combination -----------------------------------
    validateCombination(spec, bySource);

    // Which coverage rules each source must report on, deduped: three margin
    // metrics sharing `costed_line` emit four columns, not twelve.
    const coverageBySource = new Map();
    for (const [sourceId, metrics] of bySource) {
        const rules = [];
        for (const m of metrics) if (m.trust && !rules.includes(m.trust)) rules.push(m.trust);
        coverageBySource.set(sourceId, rules);
    }
    const coverageRules = [];
    for (const [sourceId, rules] of coverageBySource) {
        for (const rule of rules) {
            coverageRules.push({
                rule,
                source: sourceId,
                columns: {
                    num: `cov_${rule}_num`,
                    den: `cov_${rule}_den`,
                    numRows: `cov_${rule}_num_rows`,
                    denRows: `cov_${rule}_den_rows`,
                },
            });
        }
    }

    // --- step 4: one CTE per source -----------------------------------------
    const dimColumns = spec.dimensions.map((d, i) => ({
        dimension: d, key: `dim_${i}`, label: `dim_${i}_label`,
    }));

    const ctes = sourceIds.map((sourceId) =>
        buildSourceCte({
            src: SOURCES[sourceId],
            metrics: bySource.get(sourceId),
            coverage: coverageBySource.get(sourceId),
            dimColumns,
            spec,
            grainCtx,
            leafColumn,
            filterPlaceholders,
            values,
            P,
            pFrom,
            pTo,
            pCmpFrom,
            pCmpTo,
        }));

    // --- step 5: stitch ------------------------------------------------------
    let joinedName = sourceIds.length === 1 ? `src_${sourceIds[0]}` : 'joined';
    const stitchCtes = [];
    if (sourceIds.length > 1) {
        stitchCtes.push(buildKeysCte(sourceIds, dimColumns));
        stitchCtes.push(buildJoinedCte(sourceIds, dimColumns, bySource, coverageBySource, leafColumn));
    }

    // --- step 6: top-N with an 'Other' rollup ---------------------------------
    if (spec.topN) {
        stitchCtes.push(...buildRollupCtes({
            spec, from: joinedName, dimColumns, leafColumn, coverageRules, P,
        }));
        joinedName = 'rolled';
    }

    // --- step 7: final SELECT ------------------------------------------------
    const { selectList, columnMap, metricColumns } =
        buildFinalSelect({ spec, dimColumns, leafColumn, coverageRules, P });

    const orderBy = buildOrderBy(spec, dimColumns, metricColumns);
    const pLimit = P(spec.limit);

    const text = [
        `WITH ${[...ctes, ...stitchCtes].join(',\n')}`,
        `SELECT\n${selectList.map((c) => `  ${c}`).join(',\n')}`,
        `FROM ${joinedName}`,
        `ORDER BY ${orderBy}`,
        `LIMIT ${pLimit}`,
    ].join('\n');

    const plan = {
        sources: sourceIds,
        leafMetrics: leafIds,
        requestedMetrics: spec.metrics.map((m) => m.id),
        metricColumns,
        dimensionOrder: dimColumns.map((d) => ({ id: d.dimension.id, key: d.key, label: d.label })),
        coverageRules,
        columnMap,
        compare: !!spec.compare,
        grain: spec.grain,
        limit: spec.limit,
        rollup: spec.topN
            ? { column: ROLLUP_COLUMN, countColumn: ROLLUP_COUNT_COLUMN, n: spec.topN.n, by: spec.topN.by }
            : null,
    };

    return { text, values, plan };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every rejection here names the metric, the dimension, and why the pair is
 * impossible. A caller assembling a request against a registry it cannot see
 * has no other way to correct itself, and a builder that silently dropped the
 * refund term instead of failing would answer with a plausible wrong number.
 */
function validateCombination(spec, bySource) {
    const requestedDims = spec.dimensions.map((d) => d.id);
    const filterDims = spec.filters.map((f) => f.dimension.id);

    // Name the metric the caller actually asked for, and the component that
    // cannot answer, rather than an internal leaf id they never mentioned.
    const blame = (leafId) => {
        const requested = spec.metrics.find((m) => leavesOf(m.id).includes(leafId));
        if (!requested || requested.id === leafId) return { name: `'${leafId}'`, part: '' };
        return { name: `'${requested.id}'`, part: ` Its '${METRICS[leafId].label}' component` };
    };

    for (const [sourceId, metrics] of bySource) {
        const src = SOURCES[sourceId];
        const { name: owner, part } = blame(metrics[0].id);

        // Dimensions derived from the source's own timestamp -- the period, the
        // hour of day, the weekday -- get their own message. "No date to break
        // down by" tells the caller something true about the metric, where the
        // generic wording below would send them looking for a missing join.
        // Driven by the dimension's `needsDateColumn` flag rather than by name,
        // so adding another time dimension needs no change here.
        const timeDim = [...spec.dimensions, ...spec.filters.map((f) => f.dimension)]
            .find((d) => d.needsDateColumn);
        if (timeDim && !src.dateColumn) {
            throw new AnalyticsRequestError(
                400,
                `${owner} is a point-in-time figure and has no date, so it cannot be broken down by ${timeDim.label.toLowerCase()}.`,
                { metric: metrics[0].id, dimension: timeDim.id, source: sourceId }
            );
        }

        for (const dimId of [...requestedDims, ...filterDims]) {
            if (!src.dimensions.includes(dimId)) {
                throw new AnalyticsRequestError(
                    400,
                    `${owner} cannot be broken down by '${dimId}':${part || ' it'} is measured over ${src.label.toLowerCase()}, which carry no ${dimId} detail.`,
                    { metric: metrics[0].id, dimension: dimId, source: sourceId, supported: [...src.dimensions] }
                );
            }
        }
    }

    const grainKey = spec.grain || 'none';
    for (const m of spec.metrics) {
        if (!m.grains.includes(grainKey)) {
            throw new AnalyticsRequestError(
                400,
                grainKey === 'none'
                    ? `'${m.id}' must be broken down by a period; it supports ${m.grains.filter((g) => g !== 'none').join(', ')}.`
                    : `'${m.id}' is a point-in-time figure and cannot be broken down by ${grainKey}.`,
                { metric: m.id, grain: grainKey, supported: [...m.grains] }
            );
        }
        if (spec.compare && !m.comparable) {
            throw new AnalyticsRequestError(
                400,
                `'${m.id}' is a position as of now, not a figure for a period, so it cannot be compared against an earlier one.`,
                { metric: m.id }
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Step 4 — one CTE per fact source
// ---------------------------------------------------------------------------

function buildSourceCte({
    src, metrics, coverage, dimColumns, spec, grainCtx, leafColumn,
    filterPlaceholders, values, pFrom, pTo, pCmpFrom, pCmpTo,
}) {
    const cols = src.cols;
    const select = [];
    const groupBy = [];
    const addGrouped = (sql, alias) => {
        select.push(`${sql} AS ${alias}`);
        groupBy.push(String(select.length));
    };

    // --- bucket: 0 = the requested range, 1 = the comparison range.
    // One column, one plan, one snapshot -- rather than two round trips that can
    // disagree with each other.
    const comparing = !!spec.compare && !!src.dateColumn;
    if (comparing) {
        addGrouped(
            `CASE WHEN ${manilaDate(src.dateColumn)} BETWEEN ${pFrom()} AND ${pTo()} THEN 0 ELSE 1 END`,
            'bucket'
        );
    } else {
        // A constant needs no GROUP BY entry.
        select.push('0 AS bucket');
    }

    for (const dc of dimColumns) {
        addGrouped(dc.dimension.key(cols, src, grainCtx), dc.key);
        addGrouped(dc.dimension.keyLabel(cols, src, grainCtx), dc.label);
    }

    for (const m of metrics) {
        const filters = [];
        if (m.where) filters.push(parenthesise(m.where(cols)));
        if (m.trust) filters.push(parenthesise(trustFilterSql(TRUST_RULES[m.trust], cols)));
        const agg = filters.length
            ? `${m.expr(cols)} FILTER (WHERE ${filters.join(' AND ')})`
            : m.expr(cols);
        // A trusted metric is left NULL when nothing in the group qualified: 0
        // would assert "we made no profit here" where the truth is "we could not
        // measure any". Untrusted additive metrics genuinely are 0.
        select.push(`${m.trust ? agg : `COALESCE(${agg}, 0)`} AS ${leafColumn.get(m.id)}`);
    }

    for (const ruleId of coverage) {
        const rule = TRUST_RULES[ruleId];
        const weight = rule.weight(cols);
        const scope = rule.scope ? `(${rule.scope(cols)})` : null;
        const trusted = scope
            ? `${scope} AND (${rule.predicate(cols)})`
            : `(${rule.predicate(cols)})`;
        select.push(`COALESCE(SUM(${weight}) FILTER (WHERE ${trusted}), 0) AS cov_${ruleId}_num`);
        select.push(scope
            ? `COALESCE(SUM(${weight}) FILTER (WHERE ${scope}), 0) AS cov_${ruleId}_den`
            : `COALESCE(SUM(${weight}), 0) AS cov_${ruleId}_den`);
        select.push(`COUNT(*) FILTER (WHERE ${trusted}) AS cov_${ruleId}_num_rows`);
        select.push(scope
            ? `COUNT(*) FILTER (WHERE ${scope}) AS cov_${ruleId}_den_rows`
            : 'COUNT(*) AS cov_' + ruleId + '_den_rows');
    }

    // --- WHERE
    const where = [];
    if (src.dateColumn) {
        const d = manilaDate(src.dateColumn);
        where.push(comparing
            ? `(${d} BETWEEN ${pFrom()} AND ${pTo()} OR ${d} BETWEEN ${pCmpFrom()} AND ${pCmpTo()})`
            : `${d} BETWEEN ${pFrom()} AND ${pTo()}`);
    }
    // `defaultWhere` is handed the live values array because buildStatusClause
    // numbers its own placeholders from its current length, then appends to it.
    for (const clause of src.defaultWhere(values, { status: spec.sourceOptions.status })) {
        if (clause) where.push(clause);
    }
    for (const f of spec.filters) {
        const keyExpr = f.dimension.key(cols, src, grainCtx);
        where.push(`${keyExpr} = ANY(${filterPlaceholders.get(f.dimension.id)()}${arrayCast(f.dimension.valueType)})`);
    }

    const joins = resolveJoins(src, [
        ...spec.dimensions.flatMap((d) => d.requiresJoins),
        ...spec.filters.flatMap((f) => f.dimension.requiresJoins),
    ]);

    return [
        `src_${src.id} AS (`,
        `  SELECT\n${select.map((c) => `    ${c}`).join(',\n')}`,
        `  ${src.from}`,
        ...joins.map((j) => `  ${src.joins[j]}`),
        where.length ? `  WHERE ${where.join('\n    AND ')}` : '',
        groupBy.length ? `  GROUP BY ${groupBy.join(', ')}` : '',
        ')',
    ].filter(Boolean).join('\n');
}

/** Wrap a predicate for use as a conjunct, unless it already brackets itself. */
function parenthesise(sql) {
    const trimmed = String(sql).trim();
    return /^\(.*\)$/s.test(trimmed) ? trimmed : `(${trimmed})`;
}

function trustFilterSql(rule, cols) {
    const pred = rule.predicate(cols);
    return rule.scope ? `(${rule.scope(cols)}) AND (${pred})` : pred;
}

// ---------------------------------------------------------------------------
// Step 5 — stitching multiple sources
// ---------------------------------------------------------------------------

const keyColumns = (dimColumns) => ['bucket', ...dimColumns.flatMap((d) => [d.key, d.label])];

function buildKeysCte(sourceIds, dimColumns) {
    const cols = keyColumns(dimColumns).join(', ');
    const parts = sourceIds.map((id) => `  SELECT ${cols} FROM src_${id}`);
    return `keys AS (\n${parts.join('\n  UNION\n')}\n)`;
}

/**
 * `IS NOT DISTINCT FROM`, not `=`. Dimension keys are nullable -- brand_id is
 * NULL for a part with no brand -- and NULL = NULL is false, so an equality join
 * would silently drop the "(No brand)" row from every multi-source query. That
 * is exactly the class of quiet wrong number this design exists to prevent. It
 * costs hash-join eligibility, which is irrelevant at this row count; the escape
 * hatch, if it ever matters, is COALESCE sentinel keys.
 */
function buildJoinedCte(sourceIds, dimColumns, bySource, coverageBySource, leafColumn) {
    const keys = keyColumns(dimColumns);
    const select = keys.map((k) => `    k.${k}`);

    sourceIds.forEach((sourceId, idx) => {
        const alias = `s${idx}`;
        for (const m of bySource.get(sourceId)) {
            const col = leafColumn.get(m.id);
            // A trusted metric stays NULL where the source produced no row for the
            // key; an untrusted additive metric really is zero there.
            select.push(m.trust ? `    ${alias}.${col} AS ${col}` : `    COALESCE(${alias}.${col}, 0) AS ${col}`);
        }
        for (const ruleId of coverageBySource.get(sourceId)) {
            for (const suffix of ['num', 'den', 'num_rows', 'den_rows']) {
                select.push(`    COALESCE(${alias}.cov_${ruleId}_${suffix}, 0) AS cov_${ruleId}_${suffix}`);
            }
        }
    });

    const joins = sourceIds.map((sourceId, idx) => {
        const alias = `s${idx}`;
        const on = keys.map((k) => `${alias}.${k} IS NOT DISTINCT FROM k.${k}`).join('\n      AND ');
        return `    LEFT JOIN src_${sourceId} ${alias} ON ${on}`;
    });

    return [
        'joined AS (',
        `  SELECT\n${select.join(',\n')}`,
        '  FROM keys k',
        ...joins,
        ')',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Step 6 — top-N with an 'Other' rollup
//
// This has to happen in SQL, not in the browser. There are 444 brands and 767
// groups in this catalogue; a client that received only the rows the row limit
// allowed would compute an "Other" bar out of a truncated tail and draw it
// smaller than it is. Folding here means the returned rows are the whole
// period, so the tile's own totals are exact and nothing is truncated.
//
// The fold is done over LEAF columns, before any ratio is computed. Summing the
// tail's margin percentages would be meaningless; summing its profit and its
// costed revenue and dividing afterwards is the same rule the rest of the
// module already follows.
// ---------------------------------------------------------------------------

function buildRollupCtes({ spec, from, dimColumns, leafColumn, coverageRules, P }) {
    const dc = dimColumns[0];   // the validator guarantees exactly one, and not 'date'
    const pN = P(spec.topN.n);
    const rankSql = derivationSql(spec.topN.by, { spec, leafColumn, P });

    // The key is the tiebreak so a tie between two categories resolves the same
    // way on every run; a rollup whose membership flickers between refreshes
    // would make the 'Other' bar change height for no reason.
    const ranked = [
        'ranked AS (',
        '  SELECT j.*,',
        `    ROW_NUMBER() OVER (PARTITION BY j.bucket ORDER BY ${rankSql} DESC NULLS LAST, j.${dc.key} ASC NULLS LAST) AS rn`,
        `  FROM ${from} j`,
        ')',
    ].join('\n');

    const select = [
        '    bucket',
        `    (rn > ${pN}) AS ${ROLLUP_COLUMN}`,
        `    CASE WHEN rn <= ${pN} THEN ${dc.key} END AS ${dc.key}`,
        `    CASE WHEN rn <= ${pN} THEN ${dc.label} ELSE 'Other' END AS ${dc.label}`,
    ];
    // GROUP BY the four key columns above. Every kept row is its own group; every
    // folded row collapses onto (true, NULL, 'Other'). Including the flag in the
    // grouping is what keeps a real "(No brand)" row out of the tail bucket.
    const groupBy = ['1', '2', '3', '4'];

    const aggregates = [`    COUNT(*) AS ${ROLLUP_COUNT_COLUMN}`];
    for (const column of leafColumn.values()) {
        // SUM over an all-NULL group is NULL, which is what a trusted metric must
        // stay: "nothing here could be measured" survives the fold.
        aggregates.push(`    SUM(${column}) AS ${column}`);
    }
    for (const cov of coverageRules) {
        for (const column of Object.values(cov.columns)) {
            aggregates.push(`    SUM(${column}) AS ${column}`);
        }
    }

    const rolled = [
        'rolled AS (',
        `  SELECT\n${[...select, ...aggregates].join(',\n')}`,
        '  FROM ranked',
        `  GROUP BY ${groupBy.join(', ')}`,
        ')',
    ].join('\n');

    return [ranked, rolled];
}

// ---------------------------------------------------------------------------
// Step 6 — the final SELECT: composites, ratios and coverage ratios, computed
// after aggregation.
//
// Doing it here is what guarantees a margin percentage is never an average of
// per-row percentages, and that net = gross - refunds holds per period rather
// than per invoice.
// ---------------------------------------------------------------------------

/**
 * Expand a metric down to an expression over the leaf columns available on the
 * stitched (or rolled-up) row.
 *
 * Inline rather than alias-reference: SQL cannot use an output alias inside the
 * same SELECT list, so each derivation is expanded all the way down. Shared with
 * the rollup stage so the column a top-N is ranked by is computed by exactly the
 * same rule as the column it is later displayed as.
 */
const derivationSql = (metricId, { spec, leafColumn, P }) => {
    const sqlFor = (id) => {
        const m = METRICS[id];
        if (m.kind === 'additive' || m.kind === 'snapshot') return leafColumn.get(id);
        if (m.kind === 'composite') {
            const terms = m.terms.map((t, i) => {
                const inner = sqlFor(t.metric);
                if (i === 0) return t.sign === -1 ? `- ${inner}` : inner;
                return `${t.sign === -1 ? '-' : '+'} ${inner}`;
            });
            return `(${terms.join(' ')})`;
        }
        const num = sqlFor(m.numerator);
        const den = sqlFor(m.denominator);
        const scale = scaleSql(m, spec, P);
        // The ::numeric cast is load-bearing, not tidiness. Where both sides are
        // integer counts -- lines over invoices, say -- Postgres does integer
        // division and 2,238 / 1,259 comes back as 1 rather than 1.78. Every
        // ratio here is a real number by definition, so the cast is applied
        // once, centrally, rather than left to each metric author to remember.
        return `CASE WHEN COALESCE(${den}, 0) = 0 THEN ${zeroDenominatorLiteral(m)}`
            + ` ELSE (${num})::numeric * ${scale} / NULLIF(${den}, 0) END`;
    };
    return sqlFor(metricId);
};

function buildFinalSelect({ spec, dimColumns, leafColumn, coverageRules, P }) {
    const selectList = ['bucket'];
    const columnMap = { bucket: { kind: 'bucket' } };
    const metricColumns = {};

    if (spec.topN) {
        selectList.push(ROLLUP_COLUMN, ROLLUP_COUNT_COLUMN);
        columnMap[ROLLUP_COLUMN] = { kind: 'rollup' };
        columnMap[ROLLUP_COUNT_COLUMN] = { kind: 'rollup_count' };
    }

    for (const dc of dimColumns) {
        selectList.push(dc.key, dc.label);
        columnMap[dc.key] = { kind: 'dimension_key', dimension: dc.dimension.id };
        columnMap[dc.label] = { kind: 'dimension_label', dimension: dc.dimension.id };
    }

    const sqlFor = (metricId) => derivationSql(metricId, { spec, leafColumn, P });

    const emitted = new Set();
    const emit = (metricId, column, sql) => {
        if (emitted.has(column)) return;
        emitted.add(column);
        // A leaf is already a column on `joined`; only derivations need an alias.
        selectList.push(sql === null ? column : `${sql} AS ${column}`);
        columnMap[column] = { kind: 'metric', metric: metricId, format: METRICS[metricId].format };
        metricColumns[metricId] = column;
    };

    // Leaves first: they are plain columns, and composites that expose their
    // components need them present in the output anyway.
    for (const [metricId, column] of leafColumn) emit(metricId, column, null);

    spec.metrics.forEach((m, i) => {
        if (metricColumns[m.id]) return;
        emit(m.id, `d_${i}`, sqlFor(m.id));
    });

    for (const cov of coverageRules) {
        const { num, den, numRows, denRows } = cov.columns;
        selectList.push(
            `CASE WHEN ${den} = 0 THEN NULL ELSE ${num}::numeric / ${den} END AS cov_${cov.rule}_ratio`,
            `CASE WHEN ${denRows} = 0 THEN NULL ELSE ${numRows}::numeric / ${denRows} END AS cov_${cov.rule}_row_ratio`,
            num, den, numRows, denRows
        );
        columnMap[`cov_${cov.rule}_ratio`] = { kind: 'coverage', rule: cov.rule, field: 'valueRatio' };
        columnMap[`cov_${cov.rule}_row_ratio`] = { kind: 'coverage', rule: cov.rule, field: 'rowRatio' };
        columnMap[num] = { kind: 'coverage', rule: cov.rule, field: 'numValue' };
        columnMap[den] = { kind: 'coverage', rule: cov.rule, field: 'denValue' };
        columnMap[numRows] = { kind: 'coverage', rule: cov.rule, field: 'numRows' };
        columnMap[denRows] = { kind: 'coverage', rule: cov.rule, field: 'denRows' };
    }

    return { selectList, columnMap, metricColumns };
}

/**
 * A ratio's scale is a positional parameter even when it is the literal 100, so
 * the "no request byte reaches the text" invariant stays absolute rather than
 * having one documented exception someone later widens.
 */
function scaleSql(metric, spec, P) {
    if (metric.scale === undefined) return '1';
    if (typeof metric.scale === 'number') return P(metric.scale);
    if (metric.scale.context === 'days_in_range') return P(spec.context.days_in_range);
    throw new AnalyticsRequestError(500, `Metric '${metric.id}' asks for an unknown scale context.`);
}

function buildOrderBy(spec, dimColumns, metricColumns) {
    const dateDim = dimColumns.find((d) => d.dimension.id === 'date');
    const tiebreak = dimColumns.map((d) => `${d.key} ASC NULLS LAST`);
    // 'Other' is a summary of what is not shown, so it reads last whatever the
    // sort is -- including when the fold is larger than every named category.
    const lead = spec.topN ? ['bucket ASC', `${ROLLUP_COLUMN} ASC`] : ['bucket ASC'];

    if (spec.sort) {
        const col = metricColumns[spec.sort.by]
            || (dimColumns.find((d) => d.dimension.id === spec.sort.by) || {}).label;
        if (!col) {
            throw new AnalyticsRequestError(400, `Cannot sort by '${spec.sort.by}': it is not one of the requested metrics or dimensions.`);
        }
        // dir is 'ASC' | 'DESC', already narrowed to those two literals upstream.
        return [...lead, `${col} ${spec.sort.dir} NULLS LAST`, ...tiebreak].join(', ');
    }

    // A trend reads in time order; anything else reads biggest-first.
    if (dateDim) return [...lead, `${dateDim.key} ASC`].join(', ');
    const first = metricColumns[spec.metrics[0].id];
    return [...lead, `${first} DESC NULLS LAST`, ...tiebreak].join(', ');
}

module.exports = { buildQuery };
