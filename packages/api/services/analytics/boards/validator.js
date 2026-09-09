'use strict';

const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');
const { METRICS, DIMENSIONS, GRAINS } = require('../registry');
const { PRESETS } = require('../periods');
const { BUDGET } = require('../requestValidator');

const TILE_TYPES = new Set(['kpi', 'line', 'bar', 'table', 'heatmap']);
const DRILLDOWN_KINDS = new Set(['page', 'tile', 'filter']);
const BOARD_PERIODS = new Set(['range', 'none']);

/**
 * Validates a board specification against the metric registry, dimension definitions,
 * and board layout invariants.
 *
 * Used both at startup to validate built-in boards and at request time to validate
 * user-customizable boards from the database or API.
 */
function validateBoardSpec(board, { isRegistry = false } = {}) {
    const fail = (message) => {
        if (isRegistry) {
            throw new AnalyticsRegistryError(`Analytics boards: ${message}`);
        }
        throw new AnalyticsRequestError(400, `Invalid board: ${message}`);
    };

    if (!board || typeof board !== 'object') {
        fail('board spec must be an object');
    }

    if (!board.id || typeof board.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(board.id)) {
        fail(`board id '${board && board.id}' is invalid (must be alphanumeric with hyphens or underscores)`);
    }

    if (!board.title || typeof board.title !== 'string' || !board.title.trim()) {
        fail(`board '${board.id}' must have a non-empty title`);
    }

    if (!board.defaultPreset || !PRESETS[board.defaultPreset]) {
        fail(`board '${board.id}' has unknown default preset '${board.defaultPreset}'`);
    }

    if (board.period !== undefined && !BOARD_PERIODS.has(board.period)) {
        fail(`board '${board.id}' has unknown period mode '${board.period}'`);
    }

    if (!Array.isArray(board.tiles) || board.tiles.length === 0) {
        fail(`board '${board.id}' must declare at least one tile`);
    }

    const seenTiles = new Set();
    for (const tile of board.tiles) {
        if (!tile || typeof tile !== 'object') {
            fail(`board '${board.id}' contains an invalid tile object`);
        }
        if (!tile.id || typeof tile.id !== 'string') {
            fail(`board '${board.id}' declares a tile with no id`);
        }
        if (seenTiles.has(tile.id)) {
            fail(`board '${board.id}' declares tile '${tile.id}' twice`);
        }
        seenTiles.add(tile.id);

        if (!TILE_TYPES.has(tile.type)) {
            fail(`tile '${tile.id}' has unknown type '${tile.type}'`);
        }
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

    return board;
}

module.exports = {
    TILE_TYPES,
    DRILLDOWN_KINDS,
    BOARD_PERIODS,
    validateBoardSpec,
};
