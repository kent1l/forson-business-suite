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

// Route: GET /parts/merge/duplicates/stream
// Get potential duplicate parts with live SSE progress tracking
router.get('/parts/merge/duplicates/stream', protect, hasPermission('parts:merge'), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (type, data) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const {
            limit = 50,
            excludeMerged = true,
            minScore = 0.6
        } = req.query;

        const result = await duplicateFinder.findOptimizedDuplicateGroups({
            minScore: parseFloat(minScore),
            limit: parseInt(limit),
            excludeMerged: excludeMerged === 'true',
            progressCallback: (progress) => {
                sendEvent('progress', progress);
            }
        });

        sendEvent('complete', {
            groups: result.groups,
            aiStats: result.stats,
            metadata: {
                total: result.groups.length,
                algo: 'v2',
                minScore: parseFloat(minScore),
                limit: parseInt(limit),
                excludeMerged: excludeMerged === 'true'
            }
        });
        res.end();
    } catch (error) {
        console.error('Error finding duplicates stream:', error);
        sendEvent('error', { message: 'Internal Server Error' });
        res.end();
    }
});

// Route: GET /api/parts/merge/duplicates
// Get potential duplicate parts grouped by similarity
router.get('/parts/merge/duplicates', protect, hasPermission('parts:merge'), async (req, res) => {
    try {
        const {
            minSimilarity = 0.75,
            limit = 50,
            excludeMerged = true,
            algo = 'v1', // v1: current, v2: optimized with confidence
            minScore = 0.6 // for v2: min confidence score
        } = req.query;

        let groups;
        let aiStats = null;
        if (algo === 'v2') {
            const result = await duplicateFinder.findOptimizedDuplicateGroups({
                minScore: parseFloat(minScore),
                limit: parseInt(limit),
                excludeMerged: excludeMerged === 'true'
            });
            groups = result.groups;
            aiStats = result.stats;
        } else {
            groups = await duplicateFinder.findDuplicateGroups({
                minSimilarity: parseFloat(minSimilarity),
                limit: parseInt(limit),
                excludeMerged: excludeMerged === 'true'
            });
        }

        res.json({
            success: true,
            groups,
            aiStats,
            metadata: {
                total: groups.length,
                algo,
                ...(algo === 'v2' ? { minScore } : { minSimilarity }),
                limit,
                excludeMerged
            }
        });
    } catch (error) {
        console.error('Error finding duplicates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to find duplicate parts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

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

module.exports = router;
