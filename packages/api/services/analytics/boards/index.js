const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');
const { METRICS, DIMENSIONS, GRAINS } = require('../registry');
const { PRESETS } = require('../periods');
const { OVERVIEW_BOARD } = require('./overview');

/**
 * Board registry, validated at require() time against the metric registry.
 *
 * A tile citing a metric that has since been renamed becomes a startup failure
 * and a red test run, rather than one blank tile that nobody notices for weeks.
 */
const TILE_TYPES = new Set(['kpi', 'line', 'bar', 'table']);
const DRILLDOWN_KINDS = new Set(['page', 'tile', 'filter']);

const BOARD_LIST = [OVERVIEW_BOARD];

const fail = (message) => {
    throw new AnalyticsRegistryError(`Analytics boards: ${message}`);
};

const BOARDS = {};
for (const board of BOARD_LIST) {
    if (BOARDS[board.id]) fail(`board id '${board.id}' is declared twice`);
    if (!PRESETS[board.defaultPreset]) fail(`board '${board.id}' has unknown default preset '${board.defaultPreset}'`);

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
    }
    BOARDS[board.id] = board;
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
