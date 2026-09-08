const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');
const { METRICS, DIMENSIONS, GRAINS } = require('../registry');
const { PRESETS } = require('../periods');
const { BUDGET } = require('../requestValidator');
const { OVERVIEW_BOARD } = require('./overview');
const { SALES_BOARD } = require('./sales');
const { INVENTORY_BOARD } = require('./inventory');
const { INSIGHT_RULES, SEVERITIES } = require('../registry/insights');
const { PROFITABILITY_BOARD } = require('./profitability');
const { DATA_TRUST_BOARD } = require('./data_trust');
const { CUSTOMERS_BOARD } = require('./customers');
const { RECEIVABLES_BOARD } = require('./receivables');

/**
 * Board registry, validated at require() time against the metric registry.
 *
 * A tile citing a metric that has since been renamed becomes a startup failure
 * and a red test run, rather than one blank tile that nobody notices for weeks.
 */
const TILE_TYPES = new Set(['kpi', 'line', 'bar', 'table', 'heatmap']);
const DRILLDOWN_KINDS = new Set(['page', 'tile', 'filter']);
// A board is either about a period or about now. 'none' hides the range and
// comparison controls, because a picker that changes nothing on screen teaches
// the reader that the numbers moved with it when they did not.
const BOARD_PERIODS = new Set(['range', 'none']);

const BOARD_LIST = [
    OVERVIEW_BOARD, SALES_BOARD, INVENTORY_BOARD, PROFITABILITY_BOARD,
    CUSTOMERS_BOARD, RECEIVABLES_BOARD, DATA_TRUST_BOARD,
];

const fail = (message) => {
    throw new AnalyticsRegistryError(`Analytics boards: ${message}`);
};

const BOARDS = {};
for (const board of BOARD_LIST) {
    if (BOARDS[board.id]) fail(`board id '${board.id}' is declared twice`);
    if (!PRESETS[board.defaultPreset]) fail(`board '${board.id}' has unknown default preset '${board.defaultPreset}'`);
    if (board.period !== undefined && !BOARD_PERIODS.has(board.period)) {
        fail(`board '${board.id}' has unknown period mode '${board.period}'`);
    }

    const seenTiles = new Set();
    for (const tile of board.tiles) {
        if (seenTiles.has(tile.id)) fail(`board '${board.id}' declares tile '${tile.id}' twice`);
        seenTiles.add(tile.id);
        if (!TILE_TYPES.has(tile.type)) fail(`tile '${tile.id}' has unknown type '${tile.type}'`);
        if (!tile.query || !Array.isArray(tile.query.metrics) || tile.query.metrics.length === 0) {
            fail(`tile '${tile.id}' has no metrics`);
        }
        for (const metricId of tile.query.metrics) {
            if (!Object.prototype.hasOwnProperty.call(METRICS, metricId)) {
                fail(`tile '${tile.id}' references unknown metric '${metricId}'`);
            }
        }
        for (const dimId of tile.query.dimensions || []) {
            if (!Object.prototype.hasOwnProperty.call(DIMENSIONS, dimId)) {
                fail(`tile '${tile.id}' references unknown dimension '${dimId}'`);
            }
        }
        // 'auto' is resolved client-side from the board's period; the server only
        // ever sees a concrete grain, which the request validator then checks.
        if (tile.query.grain && tile.query.grain !== 'auto' && !GRAINS[tile.query.grain]) {
            fail(`tile '${tile.id}' references unknown grain '${tile.query.grain}'`);
        }
        if (tile.query.minGrain && !GRAINS[tile.query.minGrain]) {
            fail(`tile '${tile.id}' references unknown minGrain '${tile.query.minGrain}'`);
        }
        if (tile.query.minGrain && tile.query.grain !== 'auto') {
            fail(`tile '${tile.id}' sets minGrain without grain: 'auto', which has no effect`);
        }
        const displayValue = tile.display && tile.display.value;
        if (displayValue && !Object.prototype.hasOwnProperty.call(METRICS, displayValue)) {
            fail(`tile '${tile.id}' displays unknown metric '${displayValue}'`);
        }
        if (displayValue && !tile.query.metrics.includes(displayValue)) {
            fail(`tile '${tile.id}' displays '${displayValue}', which its own query does not ask for`);
        }
        // A drilldown is a closed vocabulary, never a URL: the frontend resolves it
        // through the existing navigation switch, so a board spec cannot become a
        // way to point a user anywhere.
        if (tile.drilldown && !DRILLDOWN_KINDS.has(tile.drilldown.kind)) {
            fail(`tile '${tile.id}' has unknown drilldown kind '${tile.drilldown.kind}'`);
        }
        if (tile.drilldown && tile.drilldown.kind === 'filter') {
            const dimId = tile.drilldown.dimension;
            const dim = DIMENSIONS[dimId];
            if (!dim) fail(`tile '${tile.id}' drills down into unknown dimension '${dimId}'`);
            // Clicking a bar adds a filter. A dimension that cannot be filtered
            // would produce a click that silently does nothing.
            if (!dim.filterable) fail(`tile '${tile.id}' drills down into '${dimId}', which cannot be filtered on`);
            if (!(tile.query.dimensions || []).includes(dimId)) {
                fail(`tile '${tile.id}' drills down into '${dimId}', which is not one of its own breakdowns`);
            }
        }

        // A heatmap names its two axes, and both must be dimensions the query
        // actually asks for -- otherwise it renders an empty grid at runtime.
        if (tile.type === 'heatmap') {
            const dims = tile.query.dimensions || [];
            for (const axis of ['rows', 'columns']) {
                const dimId = tile.display && tile.display[axis];
                if (!dimId) fail(`heatmap tile '${tile.id}' does not declare its '${axis}' axis`);
                if (!dims.includes(dimId)) {
                    fail(`heatmap tile '${tile.id}' puts '${dimId}' on its ${axis} axis but does not break down by it`);
                }
            }
            if (tile.display.rows === tile.display.columns) {
                fail(`heatmap tile '${tile.id}' uses the same dimension on both axes`);
            }
        }

        // topN is validated here as well as per request, so a board that would
        // be refused at query time is a startup failure instead of a red tile.
        if (tile.query.topN !== undefined) {
            const { n, by } = tile.query.topN || {};
            if (!Number.isInteger(n) || n < 1 || n > BUDGET.maxTopN) {
                fail(`tile '${tile.id}' has an unusable topN.n of ${JSON.stringify(n)}`);
            }
            const dims = tile.query.dimensions || [];
            if (dims.length !== 1 || dims[0] === 'date') {
                fail(`tile '${tile.id}' asks for a topN rollup but breaks down by ${JSON.stringify(dims)}; a rollup needs exactly one non-date dimension`);
            }
            if (by !== undefined && !tile.query.metrics.includes(by)) {
                fail(`tile '${tile.id}' ranks its topN by '${by}', which its own query does not ask for`);
            }
        }

        // The promise a period-less board makes to the reader: nothing on it
        // moves with a date range, so nothing on it may ask for one.
        if (board.period === 'none') {
            if (tile.query.compare) {
                fail(`tile '${tile.id}' asks for a comparison on board '${board.id}', which declares no period`);
            }
            if ((tile.query.dimensions || []).includes('date') || tile.query.grain) {
                fail(`tile '${tile.id}' breaks down by period on board '${board.id}', which declares no period`);
            }
            // `comparable` is the registry's own word for "this measures a
            // stretch of time". Anything that does belongs on a board with a
            // date picker, not on one that claims to be a position as of now.
            for (const metricId of tile.query.metrics) {
                if (METRICS[metricId].comparable) {
                    fail(`tile '${tile.id}' uses '${metricId}', which measures a period, on board '${board.id}', which declares none`);
                }
            }
        }
    }
    BOARDS[board.id] = board;
}

/**
 * Insight rules, validated here rather than in registry/insights.js: this is the
 * first module that can see both the metric registry and the board list, so it
 * is the only place a rule naming a board that does not exist can be caught.
 *
 * As everywhere else in this module, a broken rule is a startup crash rather
 * than a sentence that quietly stops appearing.
 */
for (const [id, rule] of Object.entries(INSIGHT_RULES)) {
    if (id !== rule.id) fail(`insight key '${id}' does not match its id '${rule.id}'`);
    if (!SEVERITIES.has(rule.severity)) fail(`insight '${id}' has unknown severity '${rule.severity}'`);
    if (typeof rule.when !== 'function' || typeof rule.values !== 'function') {
        fail(`insight '${id}' must declare both a \`when\` and a \`values\` function`);
    }
    if (!rule.template || !/\{\w+\}/.test(rule.template)) {
        fail(`insight '${id}' has no template, or a template with nothing substituted into it`);
    }
    if (!Array.isArray(rule.cites) || rule.cites.length === 0) {
        fail(`insight '${id}' cites nothing; an insight a reader cannot check is an opinion`);
    }
    for (const boardId of rule.boards) {
        if (!BOARDS[boardId]) fail(`insight '${id}' names board '${boardId}', which does not exist`);
    }
    for (const metricId of [...rule.cites, ...(rule.query.metrics || [])]) {
        if (!Object.prototype.hasOwnProperty.call(METRICS, metricId)) {
            fail(`insight '${id}' references unknown metric '${metricId}'`);
        }
    }
    // Everything cited must be something the rule's own query asked for, or the
    // citation points at a figure the insight never actually read.
    for (const metricId of rule.cites) {
        if (!rule.query.metrics.includes(metricId)) {
            fail(`insight '${id}' cites '${metricId}', which its own query does not ask for`);
        }
    }
    for (const dimId of rule.query.dimensions || []) {
        if (!DIMENSIONS[dimId]) fail(`insight '${id}' references unknown dimension '${dimId}'`);
    }
    if (rule.action && rule.action.board && !BOARDS[rule.action.board]) {
        fail(`insight '${id}' links to board '${rule.action.board}', which does not exist`);
    }
    if (rule.action && rule.action.page && rule.action.board) {
        fail(`insight '${id}' declares both a page and a board to open; it must be one or the other`);
    }
}

/**
 * A board as this user may see it: tiles citing a metric they lack permission
 * for are removed, not disabled, so the permission model is never restated on
 * the client.
 */
function boardFor(boardId, canSeeMetric) {
    const board = BOARDS[boardId];
    if (!board) {
        throw new AnalyticsRequestError(404, `Unknown board: ${JSON.stringify(boardId)}`, {
            valid: Object.keys(BOARDS),
        });
    }
    return {
        ...board,
        period: board.period || 'range',
        tiles: board.tiles.filter((tile) => tile.query.metrics.every(canSeeMetric)),
    };
}

const listBoards = (canSeeMetric) => Object.values(BOARDS)
    .map((b) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        tileCount: b.tiles.filter((t) => t.query.metrics.every(canSeeMetric)).length,
    }))
    .filter((b) => b.tileCount > 0);

module.exports = { BOARDS, boardFor, listBoards };
