const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const DuplicateFinder = require('../services/duplicateFinder');
const PartMergeService = require('../services/partMergeService');

const router = express.Router();

// Middleware to add database connection to request
router.use((req, res, next) => {
    req.db = db;
    next();
});

// Create service instances
const duplicateFinder = new DuplicateFinder(db);
const partMergeService = new PartMergeService(db);



// Route: GET /api/parts/merge/search-for-merge
// Search for parts similar to a given part (for manual merge initiation)
router.get('/parts/merge/search-for-merge', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const { partId, query, limit = 20 } = req.query;

        if (!partId && !query) {
            return res.status(400).json({
                success: false,
                message: 'Either partId or query parameter is required'
            });
        }

        let similarParts;
        if (partId) {
            similarParts = await duplicateFinder.findSimilarParts(parseInt(partId), {
                limit: parseInt(limit),
                minSimilarity: 0.5
            });
        } else {
            similarParts = await duplicateFinder.searchSimilarParts(query, {
                limit: parseInt(limit)
            });
        }

        res.json({
            success: true,
            parts: similarParts,
            query: { partId, query, limit }
        });
    } catch (error) {
        console.error('Error searching for similar parts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search for similar parts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route: POST /api/parts/merge/merge-preview
// Get a preview of what would happen in a merge operation
router.post('/parts/merge/merge-preview', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        console.log('DEBUG: Merge preview request:', req.body);
        
        const { sourcePartIds, targetPartId, conflictResolutions = {}, keepPartId, mergePartIds, rules } = req.body;
        
        // Handle both old and new request formats
        const finalKeepPartId = keepPartId || targetPartId;
        const finalMergePartIds = mergePartIds || sourcePartIds;
        const finalRules = rules || conflictResolutions;

        console.log('DEBUG: Starting preview merge with keepPartId:', finalKeepPartId, 'mergePartIds:', finalMergePartIds);

        if (!finalMergePartIds || !Array.isArray(finalMergePartIds) || finalMergePartIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'mergePartIds array is required and must not be empty'
            });
        }

        if (!finalKeepPartId) {
            return res.status(400).json({
                success: false,
                message: 'keepPartId is required'
            });
        }

        console.log('DEBUG: PreviewMerge called with:', { keepPartId: finalKeepPartId, mergePartIds: finalMergePartIds, rules: finalRules });

        const preview = await partMergeService.previewMerge({
            keepPartId: finalKeepPartId,
            mergePartIds: finalMergePartIds,
            rules: finalRules
        });

        res.json({
            success: true,
            ...preview
        });
    } catch (error) {
        console.error('Error generating merge preview:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate merge preview',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route: POST /api/parts/merge/merge
// Execute the actual merge operation
router.post('/parts/merge/merge', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        console.log('DEBUG: Merge request received:', req.body);
        
        const { 
            sourcePartIds, 
            targetPartId, 
            conflictResolutions = {},
            mergeNotes = '',
            preserveAliases = true
        } = req.body;

        console.log('DEBUG: Extracted merge data:', { 
            sourcePartIds, 
            targetPartId, 
            conflictResolutions, 
            mergeNotes, 
            preserveAliases 
        });

        // Convert IDs to integers to ensure proper database parameter types
        const targetPartIdInt = parseInt(targetPartId);
        const sourcePartIdsInt = sourcePartIds.map(id => parseInt(id));

        if (!sourcePartIdsInt || !Array.isArray(sourcePartIdsInt) || sourcePartIdsInt.length === 0) {
            console.log('DEBUG: sourcePartIds validation failed:', sourcePartIdsInt);
            return res.status(400).json({
                success: false,
                message: 'sourcePartIds array is required and must not be empty'
            });
        }

        if (!targetPartIdInt || isNaN(targetPartIdInt)) {
            console.log('DEBUG: targetPartId validation failed:', targetPartIdInt);
            return res.status(400).json({
                success: false,
                message: 'targetPartId is required and must be a valid number'
            });
        }

        const finalRules = {
            ...conflictResolutions,
            preserveAliases
        };

        const result = await partMergeService.executeMerge({
            keepPartId: targetPartIdInt,
            mergePartIds: sourcePartIdsInt,
            rules: finalRules
        }, req.user.employee_id);

        res.json({
            success: true,
            result: {
                mergedPartId: result.keepPartId,
                mergedPartIds: result.mergedPartIds,
                updatedCounts: result.updatedCounts,
                warnings: result.warnings
            }
        });
    } catch (error) {
        console.error('Error executing merge:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to execute merge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route: GET /api/parts/merge/:id/merge-history
// Get merge history for a specific part
router.get('/parts/merge/:id/merge-history', protect, hasPermission('parts:view'), async (req, res) => {
    try {
        const partId = parseInt(req.params.id);
        
        if (isNaN(partId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid part ID'
            });
        }

        const history = await partMergeService.getMergeHistory(partId);

        res.json({
            success: true,
            partId,
            history
        });
    } catch (error) {
        console.error('Error getting merge history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get merge history',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route: GET /api/parts/merge/:id/details-for-merge
// Get detailed part information optimized for merge operations
router.get('/parts/merge/:id/details-for-merge', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const partId = parseInt(req.params.id);
        
        if (isNaN(partId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid part ID'
            });
        }

        const details = await partMergeService.getPartDetailsForMerge(partId);
        
        if (!details) {
            return res.status(404).json({
                success: false,
                message: 'Part not found'
            });
        }

        res.json({
            success: true,
            part: details
        });
    } catch (error) {
        console.error('Error getting part details for merge:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get part details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route: POST /api/parts/merge/exclude
// Excludes two parts from future duplicate scans
router.post('/parts/merge/exclude', protect, hasPermission('parts:merge'), async (req, res) => {
    const { partId1, partId2, reason = 'Manually excluded by user' } = req.body;
    if (!partId1 || !partId2) {
        return res.status(400).json({ message: 'Missing part IDs' });
    }
    
    const id1 = Math.min(parseInt(partId1), parseInt(partId2));
    const id2 = Math.max(parseInt(partId1), parseInt(partId2));

    try {
        await req.db.query(`
            INSERT INTO part_exclusion (part_id_1, part_id_2, source, reason)
            VALUES ($1, $2, 'USER', $3)
            ON CONFLICT (part_id_1, part_id_2) DO UPDATE
            SET source = 'USER', reason = $3
        `, [id1, id2, reason]);
        res.json({ success: true, message: 'Parts successfully excluded from duplicate scans.' });
    } catch (error) {
        console.error('Failed to insert exclusion:', error);
        res.status(500).json({ message: 'Failed to exclude parts' });
    }
});

// Route: GET /api/parts/merge/worker-status
// Gets the status of the background dedupe worker
router.get('/parts/merge/worker-status', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const settingRes = await req.db.query(
            `SELECT setting_value FROM public.settings WHERE setting_key = 'DEDUPE_BACKGROUND_WORKER_ENABLED'`
        );
        const enabled = settingRes.rowCount > 0 ? settingRes.rows[0].setting_value !== 'false' : true;

        // Get the last 3 batches for history display
        const batchRes = await req.db.query(`
            SELECT batch_id, status, started_at, completed_at, total_groups, ai_calls_made, error_message, total_clusters, processed_clusters
            FROM public.duplicate_suggestion_batch
            ORDER BY batch_id DESC
            LIMIT 3
        `);

        // Count pending suggestions by tier
        const countRes = await req.db.query(`
            SELECT confidence, COUNT(*) as count
            FROM public.duplicate_suggestion_group
            WHERE status = 'pending'
            GROUP BY confidence
        `);
        const pendingSuggestions = { exact: 0, high: 0, medium: 0, low: 0, total: 0 };
        for (const row of countRes.rows) {
            pendingSuggestions[row.confidence] = parseInt(row.count);
            pendingSuggestions.total += parseInt(row.count);
        }

        res.json({
            success: true,
            enabled,
            latestBatch: batchRes.rows[0] || null,
            batchHistory: batchRes.rows,
            pendingSuggestions
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get worker status' });
    }
});

// Route: POST /api/parts/merge/worker-toggle
// Toggles the background dedupe worker
router.post('/parts/merge/worker-toggle', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const { enabled } = req.body;
        const value = enabled ? 'true' : 'false';
        
        await req.db.query(`
            INSERT INTO public.settings (setting_key, setting_value, description)
            VALUES ('DEDUPE_BACKGROUND_WORKER_ENABLED', $1, 'Enable background AI deduplication worker')
            ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1
        `, [value]);
        
        res.json({ success: true, enabled });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to toggle worker' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Route: GET /api/parts/merge/suggestions
// Returns pre-computed duplicate suggestions from the suggestion table.
// This is instant — no computation happens on this request.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/parts/merge/suggestions', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const { confidence, limit = 100, offset = 0 } = req.query;

        // Build WHERE clause based on optional confidence filter
        const conditions = [`status = 'pending'`];
        const params = [];
        if (confidence && ['exact', 'high', 'medium', 'low'].includes(confidence)) {
            params.push(confidence);
            conditions.push(`confidence = $${params.length}`);
        }

        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const sql = `
            SELECT
                suggestion_id, group_key, confidence, confidence_score,
                detection_method, ai_reason, part_ids, part_data,
                status, created_at
            FROM public.duplicate_suggestion_group
            WHERE ${conditions.join(' AND ')}
            ORDER BY
                CASE confidence
                    WHEN 'exact'   THEN 1
                    WHEN 'high'    THEN 2
                    WHEN 'medium'  THEN 3
                    WHEN 'low'     THEN 4
                END,
                confidence_score DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;

        const result = await req.db.query(sql, params);

        // Also get counts by confidence tier
        const countRes = await req.db.query(`
            SELECT confidence, COUNT(*) as count
            FROM public.duplicate_suggestion_group
            WHERE status = 'pending'
            GROUP BY confidence
        `);
        const counts = { exact: 0, high: 0, medium: 0, low: 0 };
        for (const row of countRes.rows) counts[row.confidence] = parseInt(row.count);

        // Get the latest batch info
        const batchRes = await req.db.query(`
            SELECT batch_id, status, started_at, completed_at, total_groups, ai_calls_made, error_message
            FROM public.duplicate_suggestion_batch
            ORDER BY batch_id DESC
            LIMIT 1
        `);
        const latestBatch = batchRes.rows[0] || null;

        // Transform part_data from JSONB back to the format the UI expects
        const groups = result.rows.map(row => ({
            groupId: `suggestion_${row.suggestion_id}`,
            suggestionId: row.suggestion_id,
            score: row.confidence_score,
            confidence: row.confidence === 'exact' ? 'Exact Match'
                       : row.confidence === 'high'   ? 'High'
                       : row.confidence === 'medium' ? 'Medium' : 'Low',
            confidenceTier: row.confidence, // raw value for UI tier logic
            reasons: [row.detection_method],
            ai_reasons: row.ai_reason ? [row.ai_reason] : [],
            detection_method: row.detection_method,
            parts: row.part_data, // Already the full part objects
            created_at: row.created_at
        }));

        res.json({
            success: true,
            groups,
            counts,
            latestBatch,
            metadata: { total: groups.length, limit: parseInt(limit), offset: parseInt(offset) }
        });
    } catch (error) {
        console.error('Error fetching suggestions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch suggestions' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Route: POST /api/parts/merge/suggestions/:id/dismiss
// Marks a suggestion as dismissed (user said "not duplicates").
// Also writes to part_exclusion for the relevant pairs.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/parts/merge/suggestions/:id/dismiss', protect, hasPermission('parts:merge'), async (req, res) => {
    const suggestionId = parseInt(req.params.id);
    if (isNaN(suggestionId)) {
        return res.status(400).json({ success: false, message: 'Invalid suggestion ID' });
    }

    try {
        // Get the suggestion to know which pairs to exclude
        const sgRes = await req.db.query(
            `SELECT part_ids FROM public.duplicate_suggestion_group WHERE suggestion_id = $1`,
            [suggestionId]
        );
        if (sgRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Suggestion not found' });
        }

        const partIds = sgRes.rows[0].part_ids;
        const actorId = req.user.employee_id;

        // Mark as dismissed
        await req.db.query(`
            UPDATE public.duplicate_suggestion_group
            SET status = 'dismissed', dismissed_at = NOW(), dismissed_by = $1, updated_at = NOW()
            WHERE suggestion_id = $2
        `, [actorId, suggestionId]);

        // Write exclusion pairs so the AI doesn't re-suggest these
        for (let i = 0; i < partIds.length; i++) {
            for (let j = i + 1; j < partIds.length; j++) {
                const id1 = Math.min(partIds[i], partIds[j]);
                const id2 = Math.max(partIds[i], partIds[j]);
                await req.db.query(`
                    INSERT INTO part_exclusion (part_id_1, part_id_2, source, reason)
                    VALUES ($1, $2, 'USER', 'Dismissed from suggestions by user')
                    ON CONFLICT (part_id_1, part_id_2) DO NOTHING
                `, [id1, id2]);
            }
        }

        res.json({ success: true, message: 'Suggestion dismissed and pair excluded from future scans.' });
    } catch (error) {
        console.error('Error dismissing suggestion:', error);
        res.status(500).json({ success: false, message: 'Failed to dismiss suggestion' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Route: POST /api/parts/merge/trigger-scan
// Triggers an on-demand deduplication scan in the background.
// Returns immediately — scan runs asynchronously.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/parts/merge/trigger-scan', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        // Check if a scan is already running
        const runningRes = await req.db.query(
            `SELECT batch_id FROM public.duplicate_suggestion_batch WHERE status = 'running' LIMIT 1`
        );
        if (runningRes.rowCount > 0) {
            return res.json({
                success: false,
                message: 'A scan is already running. Please wait for it to complete.',
                batchId: runningRes.rows[0].batch_id
            });
        }

        // Trigger the scan asynchronously (don't await — return immediately to the client)
        if (typeof global.runDeduplicationScan === 'function') {
            global.runDeduplicationScan().catch(err =>
                console.error('[TriggerScan] Scan failed:', err.message)
            );
        }

        res.json({ success: true, message: 'Deduplication scan started in background.' });
    } catch (error) {
        console.error('Error triggering scan:', error);
        res.status(500).json({ success: false, message: 'Failed to trigger scan' });
    }
});

module.exports = router;
