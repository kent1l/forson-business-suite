const express = require('express');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /documents - list documents with pagination, filters, and search
router.get('/documents', protect, hasPermission('documents:view'), async (req, res) => {
    let { page = 1, limit = 25, type, last_days, from, to, q, sort_by = 'date', sort_dir = 'desc' } = req.query;

    const sortMap = {
        date: 'created_at',
        referenceId: 'reference_id',
        reference: 'reference_id',
        type: 'document_type'
    };
    const sortByColumn = sortMap[String(sort_by)] || 'created_at';
    const sortDir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const offset = (Number(page) - 1) * Number(limit);
    try {
        const params = [];
        let where = 'WHERE 1=1';

        if (type && type !== 'All') { params.push(type); where += ` AND document_type = $${params.length}`; }
        if (last_days && last_days !== 'custom') { params.push(last_days); where += ` AND created_at >= now() - ($${params.length}::int * interval '1 day')`; }
        if (from && to) { params.push(from, to); where += ` AND created_at::date BETWEEN $${params.length - 1} AND $${params.length}`; }
        if (q) { params.push('%' + q + '%'); where += ` AND (reference_id ILIKE $${params.length} OR metadata::text ILIKE $${params.length})`; }

        // Updated SELECT statement with aliases and the 'status' column
        const listQuery = `
            SELECT
                id,
                document_type as "type",
                reference_id as "referenceId",
                status,
                created_at as "date",
                metadata
            FROM documents
            ${where}
            ORDER BY ${sortByColumn} ${sortDir}
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        params.push(Number(limit), offset);
        const { rows } = await db.query(listQuery, params);

        const countQuery = `SELECT COUNT(*) FROM documents ${where}`;
        const countRes = await db.query(countQuery, params.slice(0, params.length - 2));
        const total = Number(countRes.rows[0].count || 0);

        res.json({ documents: rows, total });
    } catch (err) {
        console.error('documents:list error', err.message);
        res.status(500).json({ message: 'Failed to list documents' });
    }
});

// GET /documents/:id/preview - return HTML preview (stored in metadata.preview_html or fallback)
router.get('/documents/:id/preview', protect, hasPermission('documents:view'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query('SELECT metadata FROM documents WHERE id = $1', [id]);
        if (!rows.length) return res.status(404).json({ message: 'Document not found' });
        const meta = rows[0].metadata || {};
        const html = meta.preview_html || `<div style="padding:16px">No preview available for ${id}</div>`;
        res.json({ html });
    } catch (err) {
        console.error('documents:preview', err.message);
        res.status(500).json({ message: 'Preview generation failed' });
    }
});

// GET /documents/:id/download - stream file from file_path
router.get('/documents/:id/download', protect, hasPermission('documents:download'), async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query('SELECT file_path, reference_id FROM documents WHERE id = $1', [id]);
        if (!rows.length) return res.status(404).send('Not found');
        const { file_path, reference_id } = rows[0];
        // For safety, don't let users request arbitrary paths. Here we assume file_path is an absolute path on server.
        res.download(file_path, `${reference_id || id}.pdf`, err => {
            if (err) console.error('download error', err.message);
        });
    } catch (err) {
        console.error('documents:download', err.message);
        res.status(500).send('Server error');
    }
});

// POST /documents/:id/share - create a short-lived share URL (simple token)
router.post('/documents/:id/share', protect, hasPermission('documents:share'), async (req, res) => {
    const { id } = req.params;
    const { ttl_minutes = 60 } = req.body || {};
    try {
        // simplistic share token: not secure for production
        const token = Buffer.from(`${id}:${Date.now()}`).toString('base64').replace(/=+$/, '');
        // store to a simple shares table if desired; for now return URL template
        const url = `${process.env.PUBLIC_URL || ''}/api/documents/${id}/download?share_token=${token}`;
        res.json({ url, token, ttl_minutes });
    } catch (err) {
        console.error('documents:share', err.message);
        res.status(500).json({ message: 'Failed to create share link' });
    }
});

module.exports = router;
