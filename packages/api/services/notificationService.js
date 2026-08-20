'use strict';

const db = require('../db');

/**
 * In-app notification centre.
 *
 * Visibility is resolved at read time rather than fanned out at write time —
 * see the rationale in database/migrations/20260820_03_add_notifications.sql.
 * The single source of truth for "can this user see this notification" is
 * VISIBILITY_SQL below; every query in this file builds on it so the badge
 * count and the list can never disagree.
 */

// Mirrors the admin bypass in authMiddleware.hasPermission: level 10 sees every
// permission-gated notification without the permission key being granted.
const ADMIN_LEVEL = 10;

/**
 * Visibility predicate, parameterised as ($1 = employee_id, $2 = permission
 * keys text[], $3 = is_admin boolean). Kept as one string so callers cannot
 * accidentally apply a looser rule.
 */
const VISIBILITY_SQL = `(
    n.target_employee_id = $1
    OR (
        n.required_permission IS NOT NULL
        AND ($3::boolean OR n.required_permission = ANY($2::text[]))
    )
)`;

// A notification counts as read when the user explicitly read it, or when it
// predates their "mark all as read" watermark.
const READ_SQL = `(
    r.read_at IS NOT NULL
    OR (s.all_read_before IS NOT NULL AND n.created_at <= s.all_read_before)
)`;

const JOIN_STATE_SQL = `
    LEFT JOIN notification_receipt r
           ON r.notification_id = n.notification_id AND r.employee_id = $1
    LEFT JOIN employee_notification_state s
           ON s.employee_id = $1
`;

// Expired notifications stay in the table until the groomer runs, but must not
// be shown in the meantime.
const NOT_EXPIRED_SQL = `(n.expires_at IS NULL OR n.expires_at > NOW())`;

/**
 * Turns a `req.user` into the three visibility parameters.
 */
function audienceParams(user) {
    return [
        user.employee_id,
        Array.isArray(user.permissions) ? user.permissions : [],
        Number(user.permission_level_id) === ADMIN_LEVEL,
    ];
}

/**
 * Records one notification.
 *
 * `client` may be a pool or an open transaction client — emitters that raise a
 * notification as part of a business write (leave approval, say) should pass
 * their transaction so the alert is rolled back with the change that caused it.
 *
 * Returns the inserted row, or null when `dedupeKey` matched an existing row.
 * A null return is the normal case for the daily scans re-reporting a condition
 * that is still true, and is not an error.
 */
async function emit(client, {
    type,
    category,
    severity = 'info',
    title,
    body = null,
    linkPage = null,
    linkState = null,
    entityType = null,
    entityId = null,
    requiredPermission = null,
    targetEmployeeId = null,
    dedupeKey = null,
    actorEmployeeId = null,
    expiresAt = null,
}) {
    if (!requiredPermission && !targetEmployeeId) {
        throw new Error(`notificationService.emit: '${type}' has no audience (needs requiredPermission or targetEmployeeId)`);
    }

    const { rows } = await client.query(
        `INSERT INTO notification (
             type, category, severity, title, body,
             link_page, link_state, entity_type, entity_id,
             required_permission, target_employee_id, dedupe_key,
             actor_employee_id, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING *`,
        [
            type, category, severity, title, body,
            linkPage, linkState ? JSON.stringify(linkState) : null, entityType,
            entityId === null ? null : String(entityId),
            requiredPermission, targetEmployeeId, dedupeKey,
            actorEmployeeId, expiresAt,
        ]
    );
    return rows[0] || null;
}

/**
 * Emitting must never break the business operation that triggered it. Route
 * handlers use this wrapper so a notification failure is logged and swallowed;
 * only call it *outside* a transaction (a failed statement inside one would
 * poison the transaction regardless of the catch here).
 */
async function emitSafe(payload) {
    try {
        return await emit(db, payload);
    } catch (err) {
        console.error(`[Notifications] Failed to emit '${payload && payload.type}':`, err.message);
        return null;
    }
}

/**
 * Unread count for the badge. Capped so a pathological backlog renders as
 * "99+" instead of making the user read a five-digit number.
 */
async function unreadCount(user) {
    const params = audienceParams(user);
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM (
             SELECT 1
             FROM notification n
             ${JOIN_STATE_SQL}
             WHERE ${VISIBILITY_SQL}
               AND ${NOT_EXPIRED_SQL}
               AND r.dismissed_at IS NULL
               AND NOT ${READ_SQL}
             LIMIT 100
         ) capped`,
        params
    );
    return rows[0].count;
}

/**
 * One page of the notification panel.
 *
 * Pagination is keyset, not OFFSET: the list is newest-first and new rows land
 * at the head constantly, so an offset-paged "load more" would skip or repeat
 * items whenever a scan fired mid-scroll.
 */
async function list(user, { limit = 20, before = null, unreadOnly = false } = {}) {
    const params = audienceParams(user);
    const conditions = [
        VISIBILITY_SQL,
        NOT_EXPIRED_SQL,
        'r.dismissed_at IS NULL',
    ];

    if (unreadOnly) conditions.push(`NOT ${READ_SQL}`);
    if (before) {
        params.push(before);
        conditions.push(`n.notification_id < $${params.length}`);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    params.push(safeLimit);

    const { rows } = await db.query(
        // notification_id is BIGINT, which node-postgres hands back as a string
        // to avoid precision loss. Cast it: the panel uses the id as a React key
        // and compares it against optimistic-update targets, and a silent
        // string/number mismatch there is the kind of bug that only shows up
        // once. A 90-day retention window keeps this nowhere near int range.
        `SELECT n.notification_id::int AS notification_id,
                n.type, n.category, n.severity, n.title, n.body,
                n.link_page, n.link_state, n.entity_type, n.entity_id,
                n.created_at,
                ${READ_SQL} AS is_read,
                TRIM(BOTH FROM COALESCE(a.first_name, '') || ' ' || COALESCE(a.last_name, '')) AS actor_name
         FROM notification n
         ${JOIN_STATE_SQL}
         LEFT JOIN employee a ON a.employee_id = n.actor_employee_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY n.notification_id DESC
         LIMIT $${params.length}`,
        params
    );

    return {
        notifications: rows,
        // The cursor for the next page; null once the tail is reached.
        nextCursor: rows.length === safeLimit ? rows[rows.length - 1].notification_id : null,
    };
}

/**
 * Writes a receipt for a notification the user is actually allowed to see.
 *
 * The visibility check is not decorative: without it any authenticated user
 * could enumerate notification ids and learn which alerts exist by observing
 * which writes succeed.
 */
async function setReceipt(user, notificationId, { read = null, dismissed = null }) {
    const params = audienceParams(user);
    params.push(notificationId);

    const { rows } = await db.query(
        `SELECT n.notification_id
         FROM notification n
         WHERE n.notification_id = $4 AND ${VISIBILITY_SQL}`,
        params
    );
    if (rows.length === 0) return false;

    const readExpr = read === null ? 'notification_receipt.read_at' : (read ? 'NOW()' : 'NULL');
    const dismissedExpr = dismissed === null ? 'notification_receipt.dismissed_at' : (dismissed ? 'NOW()' : 'NULL');

    await db.query(
        `INSERT INTO notification_receipt (notification_id, employee_id, read_at, dismissed_at)
         VALUES ($1, $2, ${read ? 'NOW()' : 'NULL'}, ${dismissed ? 'NOW()' : 'NULL'})
         ON CONFLICT (notification_id, employee_id) DO UPDATE
         SET read_at = ${readExpr},
             dismissed_at = ${dismissedExpr}`,
        [notificationId, user.employee_id]
    );
    return true;
}

/**
 * "Mark all as read" — a watermark bump, so it costs one row regardless of how
 * many notifications are currently visible. Anything created after this instant
 * is still unread, which is what the user means by the button.
 */
async function markAllRead(user) {
    await db.query(
        `INSERT INTO employee_notification_state (employee_id, all_read_before, updated_at)
         VALUES ($1, NOW(), NOW())
         ON CONFLICT (employee_id) DO UPDATE
         SET all_read_before = NOW(), updated_at = NOW()`,
        [user.employee_id]
    );
}

/**
 * Deletes aged-out notifications. Driven by NOTIFICATION_RETENTION_DAYS so the
 * window can be changed from Settings without a deploy.
 */
async function prune() {
    const { rows } = await db.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'NOTIFICATION_RETENTION_DAYS'"
    );
    const keepDays = Number(rows[0] && rows[0].setting_value) || 90;
    const { rows: result } = await db.query('SELECT prune_notifications($1) AS deleted', [keepDays]);
    return result[0].deleted;
}

module.exports = {
    emit,
    emitSafe,
    unreadCount,
    list,
    setReceipt,
    markAllRead,
    prune,
};
