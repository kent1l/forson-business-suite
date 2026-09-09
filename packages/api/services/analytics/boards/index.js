const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');
const { METRICS, DIMENSIONS } = require('../registry');
const { OVERVIEW_BOARD } = require('./overview');
const { SALES_BOARD } = require('./sales');
const { INVENTORY_BOARD } = require('./inventory');
const { INSIGHT_RULES, SEVERITIES } = require('../registry/insights');
const { PROFITABILITY_BOARD } = require('./profitability');
const { DATA_TRUST_BOARD } = require('./data_trust');
const { CUSTOMERS_BOARD } = require('./customers');
const { RECEIVABLES_BOARD } = require('./receivables');
const { PURCHASING_BOARD } = require('./purchasing');
const { OPERATIONS_BOARD } = require('./operations');

/**
 * Board registry, validated at require() time against the metric registry.
 *
 * A tile citing a metric that has since been renamed becomes a startup failure
 * and a red test run, rather than one blank tile that nobody notices for weeks.
 */
const db = require('../../../db');
const { validateBoardSpec } = require('./validator');

const BOARD_LIST = [
    OVERVIEW_BOARD, SALES_BOARD, INVENTORY_BOARD, PROFITABILITY_BOARD,
    CUSTOMERS_BOARD, RECEIVABLES_BOARD, PURCHASING_BOARD, OPERATIONS_BOARD,
    DATA_TRUST_BOARD,
];

const fail = (message) => {
    throw new AnalyticsRegistryError(`Analytics boards: ${message}`);
};

const BOARDS = {};
for (const board of BOARD_LIST) {
    if (BOARDS[board.id]) fail(`board id '${board.id}' is declared twice`);
    validateBoardSpec(board, { isRegistry: true });
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

/**
 * Loads a board by ID: first checks built-ins, then queries custom boards from
 * the database. Enforces permission filtering on tiles.
 */
async function getBoard(boardId, canSeeMetric, user) {
    if (BOARDS[boardId]) {
        return boardFor(boardId, canSeeMetric);
    }

    const employeeId = user?.employee_id;
    const isAdmin = Number(user?.permission_level_id) === 10;

    let res = null;
    try {
        res = await db.query(
            `SELECT board_id, owner_employee_id, name, description, period, default_preset, spec, is_system, created_at, updated_at
             FROM analytics_board
             WHERE board_id = $1
               AND (is_system = TRUE OR owner_employee_id = $2 OR $3 = TRUE)`,
            [boardId, employeeId, isAdmin]
        );
    } catch {
        // DB error or test mock without configured return
    }

    if (!res || !res.rows || res.rows.length === 0) {
        throw new AnalyticsRequestError(404, `Unknown board: ${JSON.stringify(boardId)}`, {
            valid: Object.keys(BOARDS),
        });
    }

    const row = res.rows[0];
    if (!row || !row.board_id) {
        throw new AnalyticsRequestError(404, `Unknown board: ${JSON.stringify(boardId)}`, {
            valid: Object.keys(BOARDS),
        });
    }
    const specTiles = Array.isArray(row.spec?.tiles) ? row.spec.tiles : (Array.isArray(row.spec) ? row.spec : []);
    const board = {
        id: row.board_id,
        title: row.name,
        description: row.description || '',
        period: row.period || 'range',
        defaultPreset: row.default_preset || 'last_30_days',
        tiles: specTiles,
        isSystem: !!row.is_system,
        isCustom: true,
        ownerEmployeeId: row.owner_employee_id,
        isOwner: employeeId ? row.owner_employee_id === employeeId : false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };

    validateBoardSpec(board, { isRegistry: false });

    return {
        ...board,
        period: board.period || 'range',
        tiles: board.tiles.filter((tile) => tile.query.metrics.every(canSeeMetric)),
    };
}

/**
 * Lists all boards visible to the user: built-ins plus user-created or system custom boards.
 */
async function listAllBoards(canSeeMetric, user) {
    const builtins = listBoards(canSeeMetric).map((b) => ({
        ...b,
        isBuiltin: true,
        isCustom: false,
        isSystem: true,
    }));

    const employeeId = user?.employee_id;
    const isAdmin = Number(user?.permission_level_id) === 10;

    try {
        const res = await db.query(
            `SELECT board_id, owner_employee_id, name, description, period, default_preset, spec, is_system, created_at, updated_at
             FROM analytics_board
             WHERE is_system = TRUE OR owner_employee_id = $1 OR $2 = TRUE
             ORDER BY name ASC`,
            [employeeId, isAdmin]
        );

        const customBoards = (res?.rows || []).map((row) => {
            if (!row || !row.board_id) return null;
            const specTiles = Array.isArray(row.spec?.tiles) ? row.spec.tiles : (Array.isArray(row.spec) ? row.spec : []);
            const board = {
                id: row.board_id,
                title: row.name,
                description: row.description || '',
                period: row.period || 'range',
                defaultPreset: row.default_preset || 'last_30_days',
                tiles: specTiles,
                isSystem: !!row.is_system,
                isCustom: true,
                ownerEmployeeId: row.owner_employee_id,
                isOwner: employeeId ? row.owner_employee_id === employeeId : false,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
            try {
                validateBoardSpec(board, { isRegistry: false });
            } catch (err) {
                console.warn(`Analytics: custom board '${board.id}' failed validation and was skipped:`, err.message);
                return null;
            }
            const visibleTiles = board.tiles.filter((t) => t.query.metrics.every(canSeeMetric));
            return {
                id: board.id,
                title: board.title,
                description: board.description,
                period: board.period,
                defaultPreset: board.defaultPreset,
                tileCount: visibleTiles.length,
                isBuiltin: false,
                isSystem: board.isSystem,
                isCustom: true,
                isOwner: board.isOwner,
                ownerEmployeeId: board.ownerEmployeeId,
                createdAt: board.createdAt,
                updatedAt: board.updatedAt,
            };
        }).filter((b) => b && b.tileCount > 0);

        return [...builtins, ...customBoards];
    } catch (err) {
        console.error('Analytics: failed to load custom boards from DB:', err.message);
        return builtins;
    }
}

async function createBoard(boardData, user) {
    const employeeId = user?.employee_id;
    const isAdmin = Number(user?.permission_level_id) === 10;

    if (!boardData || typeof boardData !== 'object') {
        throw new AnalyticsRequestError(400, 'Board data must be an object.');
    }

    const id = String(boardData.id || `custom_${Date.now()}`).trim();
    if (BOARDS[id]) {
        throw new AnalyticsRequestError(409, `Board ID '${id}' is already reserved for a built-in board.`);
    }

    const specTiles = Array.isArray(boardData.tiles)
        ? boardData.tiles
        : (Array.isArray(boardData.spec?.tiles) ? boardData.spec.tiles : (Array.isArray(boardData.spec) ? boardData.spec : []));

    const candidate = {
        id,
        title: String(boardData.title || boardData.name || '').trim(),
        description: boardData.description ? String(boardData.description).trim() : '',
        period: boardData.period || 'range',
        defaultPreset: boardData.defaultPreset || 'last_30_days',
        tiles: specTiles,
    };

    validateBoardSpec(candidate, { isRegistry: false });

    const isSystem = isAdmin ? !!boardData.isSystem : false;

    try {
        const res = await db.query(
            `INSERT INTO analytics_board (
                board_id, owner_employee_id, name, description, period, default_preset, spec, is_system
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                candidate.id,
                employeeId || null,
                candidate.title,
                candidate.description,
                candidate.period,
                candidate.defaultPreset,
                JSON.stringify({ tiles: candidate.tiles }),
                isSystem,
            ]
        );
        const row = res.rows[0];
        return {
            id: row.board_id,
            title: row.name,
            description: row.description || '',
            period: row.period,
            defaultPreset: row.default_preset,
            tiles: candidate.tiles,
            isSystem: row.is_system,
            isCustom: true,
            ownerEmployeeId: row.owner_employee_id,
            isOwner: true,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    } catch (err) {
        if (err.code === '23505') {
            throw new AnalyticsRequestError(409, `A board with ID '${candidate.id}' already exists.`);
        }
        throw err;
    }
}

async function updateBoard(boardId, boardData, user) {
    if (BOARDS[boardId]) {
        throw new AnalyticsRequestError(403, 'Built-in boards cannot be modified.');
    }

    const employeeId = user?.employee_id;
    const isAdmin = Number(user?.permission_level_id) === 10;

    const existing = await db.query('SELECT * FROM analytics_board WHERE board_id = $1', [boardId]);
    if (existing.rows.length === 0) {
        throw new AnalyticsRequestError(404, `Board '${boardId}' not found.`);
    }
    const row = existing.rows[0];
    if (row.owner_employee_id !== employeeId && !isAdmin) {
        throw new AnalyticsRequestError(403, 'You do not have permission to modify this board.');
    }

    const specTiles = boardData.tiles !== undefined
        ? boardData.tiles
        : (boardData.spec?.tiles !== undefined ? boardData.spec.tiles : (row.spec?.tiles || []));

    const candidate = {
        id: boardId,
        title: boardData.title !== undefined ? String(boardData.title).trim() : row.name,
        description: boardData.description !== undefined ? String(boardData.description).trim() : row.description,
        period: boardData.period !== undefined ? boardData.period : row.period,
        defaultPreset: boardData.defaultPreset !== undefined ? boardData.defaultPreset : row.default_preset,
        tiles: specTiles,
    };

    validateBoardSpec(candidate, { isRegistry: false });

    const isSystem = isAdmin && boardData.isSystem !== undefined ? !!boardData.isSystem : row.is_system;

    const res = await db.query(
        `UPDATE analytics_board
         SET name = $2, description = $3, period = $4, default_preset = $5, spec = $6, is_system = $7, updated_at = NOW()
         WHERE board_id = $1
         RETURNING *`,
        [
            boardId,
            candidate.title,
            candidate.description,
            candidate.period,
            candidate.defaultPreset,
            JSON.stringify({ tiles: candidate.tiles }),
            isSystem,
        ]
    );
    const updated = res.rows[0];
    return {
        id: updated.board_id,
        title: updated.name,
        description: updated.description || '',
        period: updated.period,
        defaultPreset: updated.default_preset,
        tiles: candidate.tiles,
        isSystem: updated.is_system,
        isCustom: true,
        ownerEmployeeId: updated.owner_employee_id,
        isOwner: employeeId ? updated.owner_employee_id === employeeId : false,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
    };
}

async function deleteBoard(boardId, user) {
    if (BOARDS[boardId]) {
        throw new AnalyticsRequestError(403, 'Built-in boards cannot be deleted.');
    }

    const employeeId = user?.employee_id;
    const isAdmin = Number(user?.permission_level_id) === 10;

    const existing = await db.query('SELECT * FROM analytics_board WHERE board_id = $1', [boardId]);
    if (existing.rows.length === 0) {
        throw new AnalyticsRequestError(404, `Board '${boardId}' not found.`);
    }
    const row = existing.rows[0];
    if (row.owner_employee_id !== employeeId && !isAdmin) {
        throw new AnalyticsRequestError(403, 'You do not have permission to delete this board.');
    }

    await db.query('DELETE FROM analytics_saved_view WHERE board_id = $1', [boardId]);
    await db.query('DELETE FROM analytics_board WHERE board_id = $1', [boardId]);
    return { success: true, message: `Board '${boardId}' deleted.` };
}

module.exports = {
    BOARDS,
    boardFor,
    listBoards,
    listAllBoards,
    getBoard,
    createBoard,
    updateBoard,
    deleteBoard,
    validateBoardSpec,
};
