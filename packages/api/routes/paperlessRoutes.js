'use strict';

const express = require('express');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const paperlessService = require('../services/paperlessService');
const { generateReceiptConsolidationPDF } = require('../helpers/pdf/receiptConsolidationPdf');
const router = express.Router();

// GET /api/paperless/health - Health check endpoint
router.get('/paperless/health', protect, hasPermission('documents:view'), async (req, res) => {
    try {
        const health = await paperlessService.testConnection();
        res.json(health);
    } catch (err) {
        res.status(500).json({ status: 'error', healthy: false, message: err.message });
    }
});

// GET /api/paperless/documents - List/Query Paperless documents
router.get('/paperless/documents', protect, hasPermission('documents:view'), async (req, res) => {
    try {
        const data = await paperlessService.listDocuments(req.query);
        res.json(data);
    } catch (err) {
        console.error('[PaperlessRoutes] Error fetching documents:', err.message);
        res.status(err.status || 500).json({ message: err.message || 'Failed to fetch Paperless documents' });
    }
});

// GET /api/paperless/tags - List tags available in Paperless
router.get('/paperless/tags', protect, hasPermission('documents:view'), async (req, res) => {
    try {
        const data = await paperlessService.listTags();
        res.json(data);
    } catch (err) {
        console.error('[PaperlessRoutes] Error fetching tags:', err.message);
        res.status(err.status || 500).json({ message: err.message || 'Failed to fetch Paperless tags' });
    }
});

// GET /api/paperless/match-receipt - Match physical receipt number to Paperless document title
router.get('/paperless/match-receipt', protect, hasPermission('documents:view'), async (req, res) => {
    const { receipt_no } = req.query;
    if (!receipt_no) {
        return res.status(400).json({ message: 'Missing receipt_no parameter' });
    }

    try {
        const doc = await paperlessService.findDocumentByReceiptNo(receipt_no);
        res.json({ receipt_no, matched: Boolean(doc), document: doc });
    } catch (err) {
        console.error('[PaperlessRoutes] Error matching receipt:', err.message);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/paperless/documents/:id/preview - Get binary image artifact preview
router.get('/paperless/documents/:id/preview', protect, hasPermission('documents:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const buffer = await paperlessService.downloadDocumentArtifact(id, 'preview');
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (err) {
        console.error(`[PaperlessRoutes] Error fetching preview for doc ${id}:`, err.message);
        res.status(err.status || 500).send('Failed to fetch artifact preview');
    }
});

// POST /api/paperless/consolidate - Generate 2x2 A4 printable PDF
router.post('/paperless/consolidate', protect, hasPermission('documents:view'), async (req, res) => {
    const { document_ids = [], items: customItems = [], add_tag_ids = [], remove_tag_ids = [] } = req.body || {};

    try {
        const receiptItems = [];

        // 1. Process custom passed items or fetch from Paperless IDs
        if (Array.isArray(customItems) && customItems.length > 0) {
            for (const item of customItems) {
                if (item.paperless_id && !item.imageBuffer && !item.imageDataUri) {
                    try {
                        const imgBuf = await paperlessService.downloadDocumentArtifact(item.paperless_id, 'thumb');
                        receiptItems.push({
                            ...item,
                            imageBuffer: imgBuf,
                        });
                    } catch {
                        receiptItems.push(item);
                    }
                } else {
                    receiptItems.push(item);
                }
            }
        } else if (Array.isArray(document_ids) && document_ids.length > 0) {
            for (const docId of document_ids) {
                try {
                    const imgBuf = await paperlessService.downloadDocumentArtifact(docId, 'thumb');
                    receiptItems.push({
                        paperless_id: docId,
                        imageBuffer: imgBuf,
                        physical_receipt_no: `Doc #${docId}`,
                        system_code: `PAPERLESS-${docId}`,
                    });
                } catch (err) {
                    console.error(`[PaperlessRoutes] Could not fetch artifact for doc ${docId}:`, err.message);
                    receiptItems.push({
                        paperless_id: docId,
                        physical_receipt_no: `Doc #${docId}`,
                        system_code: `PAPERLESS-${docId}`,
                    });
                }
            }
        }

        // 2. Generate 2x2 A4 PDF buffer
        const pdfBuffer = await generateReceiptConsolidationPDF(receiptItems, { returnBuffer: true });

        // 3. Perform tag updates in Paperless if requested
        if ((add_tag_ids.length > 0 || remove_tag_ids.length > 0) && document_ids.length > 0) {
            for (const docId of document_ids) {
                try {
                    await paperlessService.updateDocumentTags(docId, { addTags: add_tag_ids, removeTags: remove_tag_ids });
                } catch (tErr) {
                    console.error(`[PaperlessRoutes] Warning: Failed to update tags on doc ${docId}:`, tErr.message);
                }
            }
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Paperless_Consolidated_Receipts_${Date.now()}.pdf`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[PaperlessRoutes] Error consolidating receipts:', err);
        res.status(500).json({ message: 'Failed to generate 2x2 printable receipt layout' });
    }
});

// POST /api/paperless/update-tags - Update document tags
router.post('/paperless/update-tags', protect, hasPermission('documents:view'), async (req, res) => {
    const { document_id, add_tag_ids = [], remove_tag_ids = [] } = req.body || {};
    if (!document_id) {
        return res.status(400).json({ message: 'Missing document_id' });
    }

    try {
        const result = await paperlessService.updateDocumentTags(document_id, {
            addTags: add_tag_ids,
            removeTags: remove_tag_ids,
        });
        res.json({ success: true, result });
    } catch (err) {
        console.error(`[PaperlessRoutes] Error updating tags for doc ${document_id}:`, err.message);
        res.status(err.status || 500).json({ message: err.message });
    }
});

module.exports = router;
