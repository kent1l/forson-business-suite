const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const {
    buildCatalogRows,
    buildCatalogPage,
    getCurrentChangeCursor
} = require('../services/catalogSyncService');

const router = express.Router();

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const parseLimit = (raw) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
};

const parseCursor = (raw) => {
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Full catalog, paged by part_id, for a phone that has never synced.
 *
 * Deliberately not a replay of the change log from zero: the log records every
 * edit ever made, so a part touched forty times would cost forty rows on a
 * fresh install, and the log is pruned rather than retained forever. Walking
 * parts_view by primary key is both cheaper and actually correct as a snapshot.
 *
 * The returned sync_cursor is read once, before the first page, so any part
 * edited during the bootstrap window carries a change_id above it and gets
 * re-delivered by the client's first delta. At worst that is one redundant
 * upsert; it can never be a lost update.
 */
router.get('/catalog/sync/bootstrap', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    try {
        const cursor = parseCursor(req.query.cursor);
        const limit = parseLimit(req.query.limit);

        const parts = await buildCatalogPage(cursor, limit);
        const hasMore = parts.length === limit;

        const body = {
            parts,
            next_cursor: parts.length ? parts[parts.length - 1].part_id : cursor,
            has_more: hasMore
        };

        // Only the first page carries the cursor, so the client anchors its
        // delta stream to where the snapshot began rather than where it ended.
        if (cursor === 0) body.sync_cursor = await getCurrentChangeCursor();

        res.json(body);
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

/**
 * Everything that changed since the client's cursor.
 *
 * Reads catalog_change_log, which is trigger-fed (see the 20260817_03
 * migration) and so covers barcode, part-number, tag, fitment, and rename
 * edits -- none of which are durably recorded anywhere else.
 *
 * Deactivation and merges arrive as upserts carrying is_active = false or
 * merged_into_part_id, not as deletions: the row still exists and still needs
 * to be findable in history. Only a real row delete removes a local row.
 */
router.get('/catalog/sync', protect, hasPermission(['parts:view', 'pos:use']), async (req, res) => {
    try {
        const since = parseCursor(req.query.since);
        const limit = parseLimit(req.query.limit);

        const { rows: events } = await db.query(
            `SELECT change_id, change_type, part_id
               FROM catalog_change_log
              WHERE change_id > $1
              ORDER BY change_id ASC
              LIMIT $2`,
            [since, limit]
        );

        if (events.length === 0) {
            return res.json({ parts: [], deleted_part_ids: [], next_since: since, has_more: false });
        }

        // The cursor advances past every raw event examined, not just the
        // collapsed survivors -- otherwise coalescing duplicates inside a page
        // would silently rewind the stream and replay them forever.
        const nextSince = Number(events[events.length - 1].change_id);
        const hasMore = events.length === limit;

        // Last event per part wins within this page: an edit followed by a
        // delete is a delete, and three edits are one upsert.
        const latestByPart = new Map();
        events.forEach((e) => latestByPart.set(Number(e.part_id), e.change_type));

        const upsertIds = [];
        const deletedPartIds = [];
        latestByPart.forEach((changeType, partId) => {
            if (changeType === 'delete') deletedPartIds.push(partId);
            else upsertIds.push(partId);
        });

        const parts = await buildCatalogRows(upsertIds);

        // A part whose row is gone from parts_view despite an upsert event was
        // hard-deleted after the event was written; tell the client to drop it
        // rather than leaving a phantom behind.
        const returnedIds = new Set(parts.map((p) => p.part_id));
        upsertIds.forEach((id) => {
            if (!returnedIds.has(id)) deletedPartIds.push(id);
        });

        res.json({
            parts,
            deleted_part_ids: deletedPartIds,
            next_since: nextSince,
            has_more: hasMore
        });
    } catch (err) {
        console.error(`[${req.method} ${req.url}] Internal Error:`, err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

module.exports = router;
