const express = require('express');
const db = require('../db');
const { hasPermission } = require('../middleware/authMiddleware');
const duplicateFinder = require('../services/duplicateFinder');
const partMergeService = require('../services/partMergeService');

const router = express.Router();

// Middleware to add database connection to request
router.use((req, res, next) => {
    req.db = db;
    next();
});

// Route: GET /api/parts/merge/duplicates
// Get potential duplicate parts grouped by similarity
router.get('/parts/merge/duplicates', hasPermission('parts:merge'), async (req, res) => {
    try {
        const {
            minSimilarity = 0.75,
            limit = 50,
            excludeMerged = true
        } = req.query;

        const groups = await duplicateFinder.findDuplicateGroups({
            minSimilarity: parseFloat(minSimilarity),
            limit: parseInt(limit),
            excludeMerged: excludeMerged === 'true'
        });

        res.json({
            success: true,
            groups,
            metadata: {
                total: groups.length,
                minSimilarity,
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
router.get('/parts/merge/search-for-merge', hasPermission('parts:merge'), async (req, res) => {
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
router.post('/parts/merge/merge-preview', hasPermission('parts:merge'), async (req, res) => {
    try {
        const { sourcePartIds, targetPartId, conflictResolutions = {} } = req.body;

        if (!sourcePartIds || !Array.isArray(sourcePartIds) || sourcePartIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'sourcePartIds array is required and must not be empty'
            });
        }

        if (!targetPartId) {
            return res.status(400).json({
                success: false,
                message: 'targetPartId is required'
            });
        }

        const preview = await partMergeService.generateMergePreview({
            sourcePartIds,
            targetPartId,
            conflictResolutions,
            userId: req.user.userId
        });

        res.json({
            success: true,
            preview
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
router.post('/parts/merge/merge', hasPermission('parts:merge'), async (req, res) => {
    try {
        const { 
            sourcePartIds, 
            targetPartId, 
            conflictResolutions = {},
            mergeNotes = '',
            preserveAliases = true
        } = req.body;

        if (!sourcePartIds || !Array.isArray(sourcePartIds) || sourcePartIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'sourcePartIds array is required and must not be empty'
            });
        }

        if (!targetPartId) {
            return res.status(400).json({
                success: false,
                message: 'targetPartId is required'
            });
        }

        const result = await partMergeService.executeMerge({
            sourcePartIds,
            targetPartId,
            conflictResolutions,
            mergeNotes,
            preserveAliases,
            userId: req.user.userId
        });

        res.json({
            success: true,
            result: {
                mergedPartId: result.targetPartId,
                mergedPartIds: result.sourcePartIds,
                conflicts: result.conflicts,
                logId: result.logId,
                summary: result.summary
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
router.get('/parts/merge/:id/merge-history', hasPermission('parts:view'), async (req, res) => {
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
router.get('/parts/merge/:id/details-for-merge', hasPermission('parts:merge'), async (req, res) => {
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

module.exports = router;
