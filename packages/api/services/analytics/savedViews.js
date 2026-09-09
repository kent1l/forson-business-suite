'use strict';

const db = require('../../db');
const { AnalyticsRequestError } = require('./errors');

/**
 * Saved Views for Analytics Boards (Phase 5).
 *
 * Allows users to persist their board configurations (date presets, compare mode,
 * dimension filters) and mark a favourite view as their default.
 */

async function listSavedViews(employeeId, boardId = null) {
    if (!employeeId) return [];
    const query = boardId
        ? `SELECT view_id, board_id, owner_employee_id, name, state, is_default, created_at, updated_at
           FROM analytics_saved_view
           WHERE owner_employee_id = $1 AND board_id = $2
           ORDER BY is_default DESC, name ASC`
        : `SELECT view_id, board_id, owner_employee_id, name, state, is_default, created_at, updated_at
           FROM analytics_saved_view
           WHERE owner_employee_id = $1
           ORDER BY board_id ASC, is_default DESC, name ASC`;
    const params = boardId ? [employeeId, boardId] : [employeeId];
    const { rows } = await db.query(query, params);
    return rows.map((r) => ({
        viewId: r.view_id,
        boardId: r.board_id,
        ownerEmployeeId: r.owner_employee_id,
        name: r.name,
        state: r.state,
        isDefault: r.is_default,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    }));
}

async function createSavedView(employeeId, { boardId, name, state, isDefault = false }) {
    if (!employeeId) {
        throw new AnalyticsRequestError(401, 'Authentication required to save views.');
    }
    if (!boardId || typeof boardId !== 'string') {
        throw new AnalyticsRequestError(400, 'boardId is required.');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new AnalyticsRequestError(400, 'name is required.');
    }
    if (!state || typeof state !== 'object') {
        throw new AnalyticsRequestError(400, 'state must be an object.');
    }

    const trimmedName = name.trim();
    const shouldBeDefault = !!isDefault;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        if (shouldBeDefault) {
            await client.query(
                'UPDATE analytics_saved_view SET is_default = FALSE WHERE owner_employee_id = $1 AND board_id = $2',
                [employeeId, boardId]
            );
        }

        const { rows } = await client.query(
            `INSERT INTO analytics_saved_view (
                board_id, owner_employee_id, name, state, is_default
             ) VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [boardId, employeeId, trimmedName, JSON.stringify(state), shouldBeDefault]
        );

        await client.query('COMMIT');
        const r = rows[0];
        return {
            viewId: r.view_id,
            boardId: r.board_id,
            ownerEmployeeId: r.owner_employee_id,
            name: r.name,
            state: r.state,
            isDefault: r.is_default,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            throw new AnalyticsRequestError(409, `A saved view named '${trimmedName}' already exists on this board.`);
        }
        throw err;
    } finally {
        client.release();
    }
}

async function updateSavedView(employeeId, viewId, { name, state, isDefault }, isAdmin = false) {
    if (!employeeId) {
        throw new AnalyticsRequestError(401, 'Authentication required.');
    }
    const existing = await db.query('SELECT * FROM analytics_saved_view WHERE view_id = $1', [viewId]);
    if (existing.rows.length === 0) {
        throw new AnalyticsRequestError(404, `Saved view '${viewId}' not found.`);
    }
    const row = existing.rows[0];
    if (row.owner_employee_id !== employeeId && !isAdmin) {
        throw new AnalyticsRequestError(403, 'You do not have permission to modify this saved view.');
    }

    const trimmedName = name !== undefined ? String(name).trim() : row.name;
    const nextState = state !== undefined ? state : row.state;
    const nextDefault = isDefault !== undefined ? !!isDefault : row.is_default;

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        if (nextDefault) {
            await client.query(
                'UPDATE analytics_saved_view SET is_default = FALSE WHERE owner_employee_id = $1 AND board_id = $2 AND view_id <> $3',
                [row.owner_employee_id, row.board_id, viewId]
            );
        }

        const { rows } = await client.query(
            `UPDATE analytics_saved_view
             SET name = $2, state = $3, is_default = $4, updated_at = NOW()
             WHERE view_id = $1
             RETURNING *`,
            [viewId, trimmedName, JSON.stringify(nextState), nextDefault]
        );

        await client.query('COMMIT');
        const r = rows[0];
        return {
            viewId: r.view_id,
            boardId: r.board_id,
            ownerEmployeeId: r.owner_employee_id,
            name: r.name,
            state: r.state,
            isDefault: r.is_default,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            throw new AnalyticsRequestError(409, `A saved view named '${trimmedName}' already exists on this board.`);
        }
        throw err;
    } finally {
        client.release();
    }
}

async function deleteSavedView(employeeId, viewId, isAdmin = false) {
    if (!employeeId) {
        throw new AnalyticsRequestError(401, 'Authentication required.');
    }
    const existing = await db.query('SELECT * FROM analytics_saved_view WHERE view_id = $1', [viewId]);
    if (existing.rows.length === 0) {
        throw new AnalyticsRequestError(404, `Saved view '${viewId}' not found.`);
    }
    const row = existing.rows[0];
    if (row.owner_employee_id !== employeeId && !isAdmin) {
        throw new AnalyticsRequestError(403, 'You do not have permission to delete this saved view.');
    }

    await db.query('DELETE FROM analytics_saved_view WHERE view_id = $1', [viewId]);
    return { success: true, message: `Saved view '${viewId}' deleted.` };
}

module.exports = {
    listSavedViews,
    createSavedView,
    updateSavedView,
    deleteSavedView,
};
