const express = require('express');
const multer = require('multer');
const db = require('../db');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

const ALLOWED_MIME_TYPES = ['image/png', 'image/svg+xml', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
});

// Reads PNG/WebP dimensions directly from header bytes, no imaging dependency needed.
// Returns null for formats without a fixed intrinsic pixel size (e.g. SVG).
function readImageDimensions(buffer, mimeType) {
    try {
        if (mimeType === 'image/png' && buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
            return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
        }
        if (mimeType === 'image/webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
            const chunkFormat = buffer.toString('ascii', 12, 16);
            if (chunkFormat === 'VP8X') {
                return {
                    width: 1 + buffer.readUIntLE(24, 3),
                    height: 1 + buffer.readUIntLE(27, 3),
                };
            }
            if (chunkFormat === 'VP8 ') {
                return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
            }
        }
    } catch {
        // Malformed header - dimensions are informational only, safe to skip.
    }
    return null;
}

const BRAND_SETTING_KEYS = ['BRAND_PRIMARY_COLOR', 'BRAND_ACCENT_COLOR', 'BRAND_PRIMARY_COLOR_DARK', 'BRAND_ACCENT_COLOR_DARK', 'BRAND_THEME_NAME'];

// GET /api/branding/theme - Public, exposes only the brand color settings
// (not the full /api/settings set, which requires auth) so the login page
// and app shell can theme themselves before the user is authenticated.
router.get('/branding/theme', async (req, res) => {
    try {
        const { rows } = await db.query(
            'SELECT setting_key, setting_value FROM settings WHERE setting_key = ANY($1)',
            [BRAND_SETTING_KEYS]
        );
        const theme = rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.json(theme);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// GET /api/branding/logo/:variant - Public, serves the current logo image bytes
router.get('/branding/logo/:variant', async (req, res) => {
    const { variant } = req.params;
    if (variant !== 'full' && variant !== 'icon') {
        return res.status(400).json({ message: 'Invalid logo variant.' });
    }
    try {
        const { rows } = await db.query(
            'SELECT mime_type, file_bytes, updated_at FROM brand_asset WHERE variant = $1',
            [variant]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'No logo uploaded for this variant.' });
        }
        const asset = rows[0];
        const etag = `"${new Date(asset.updated_at).getTime()}"`;
        res.set('Content-Type', asset.mime_type);
        res.set('Cache-Control', 'public, max-age=300, must-revalidate');
        res.set('ETag', etag);
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }
        res.send(asset.file_bytes);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// POST /api/branding/logo/:variant - Upload/replace the logo for a variant
router.post('/branding/logo/:variant', protect, hasPermission('settings:edit'), upload.single('logo'), async (req, res) => {
    const { variant } = req.params;
    if (variant !== 'full' && variant !== 'icon') {
        return res.status(400).json({ message: 'Invalid logo variant.' });
    }
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ message: 'Please select an image to upload.' });
    }

    const { buffer, mimetype, size } = req.file;
    if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
        return res.status(400).json({ message: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}.` });
    }
    if (size > MAX_FILE_SIZE) {
        return res.status(400).json({ message: 'File is too large. Maximum size is 2MB.' });
    }

    const dimensions = readImageDimensions(buffer, mimetype);

    try {
        await db.query(
            `INSERT INTO brand_asset (variant, mime_type, file_bytes, file_size, width_px, height_px, updated_at, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
             ON CONFLICT (variant) DO UPDATE SET
                mime_type = EXCLUDED.mime_type,
                file_bytes = EXCLUDED.file_bytes,
                file_size = EXCLUDED.file_size,
                width_px = EXCLUDED.width_px,
                height_px = EXCLUDED.height_px,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by`,
            [variant, mimetype, buffer, size, dimensions?.width ?? null, dimensions?.height ?? null, req.user.employee_id]
        );
        res.status(200).json({ message: 'Logo updated successfully.', variant, size, dimensions });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// DELETE /api/branding/logo/:variant - Remove the logo for a variant, reverting to default
router.delete('/branding/logo/:variant', protect, hasPermission('settings:edit'), async (req, res) => {
    const { variant } = req.params;
    if (variant !== 'full' && variant !== 'icon') {
        return res.status(400).json({ message: 'Invalid logo variant.' });
    }
    try {
        await db.query('DELETE FROM brand_asset WHERE variant = $1', [variant]);
        res.json({ message: 'Logo removed successfully.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
