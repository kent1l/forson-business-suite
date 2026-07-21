const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const multer = require('multer');
const { exec } = require('child_process');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

const BACKUP_DIR = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.resolve('/backups');

// Strict regex matching valid manual, uploaded, and scheduled backup file naming conventions
const SAFE_FILENAME_REGEX = /^(forson-db-manual-|forson-db-upload-|backup-)[a-zA-Z0-9_-]+\.sql\.gz$/;

// Configure multer for memory storage (100MB limit per upload)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }
});

// In-memory lock to prevent concurrent backup/restore operations
let isOperationInProgress = false;

// Validates that the filename matches the safe pattern and resides inside BACKUP_DIR
function safePath(filename) {
    if (!filename || typeof filename !== 'string') return null;
    const base = path.basename(filename);
    if (!SAFE_FILENAME_REGEX.test(base)) return null;
    const resolved = path.resolve(BACKUP_DIR, base);
    return resolved.startsWith(BACKUP_DIR + path.sep) || resolved === BACKUP_DIR
        ? resolved
        : null;
}

// Helper to determine backup origin type
function getBackupType(filename) {
    if (filename.startsWith('forson-db-manual-')) return 'manual';
    if (filename.startsWith('forson-db-upload-')) return 'upload';
    return 'scheduled';
}

// Returns env with PGPASSWORD set (avoids password in process list / CLI args)
function pgEnv() {
    return { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
}

// Returns a postgres connection URL without the password embedded
function pgUrl() {
    const { DB_USER, DB_HOST, DB_PORT, DB_NAME } = process.env;
    return `postgresql://${DB_USER}@${DB_HOST}:${DB_PORT || 5432}/${DB_NAME}`;
}

// GET /api/backups - List all available backups
router.get('/', protect, hasPermission('backups:view'), (req, res) => {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    fs.readdir(BACKUP_DIR, (err, files) => {
        if (err) {
            if (err.code === 'ENOENT') return res.json([]);
            console.error('Failed to read backup directory:', err);
            return res.status(500).json({ message: 'Failed to retrieve backups.' });
        }
        const backups = files
            .filter(file => SAFE_FILENAME_REGEX.test(file))
            .map(file => {
                const filePath = path.join(BACKUP_DIR, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    size: stats.size,
                    createdAt: stats.mtime,
                    type: getBackupType(file)
                };
            })
            .sort((a, b) => b.createdAt - a.createdAt);
        res.json(backups);
    });
});

// POST /api/backups - Create a new on-demand backup
router.post('/', protect, hasPermission('backups:create'), (req, res) => {
    if (isOperationInProgress) {
        return res.status(409).json({ message: 'A backup or restore operation is already in progress. Please wait.' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `forson-db-manual-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    // Ensure directory exists (defensive; volume should already be mounted)
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    isOperationInProgress = true;

    // --clean --if-exists matches the scheduled backup format (safe for restore)
    // --no-owner --no-acl makes dump portable across DB users
    const command = `pg_dump "${pgUrl()}" --clean --if-exists --no-owner --no-acl | gzip > "${filepath}" && chmod 644 "${filepath}"`;

    exec(command, { env: pgEnv() }, (error, stdout, stderr) => {
        isOperationInProgress = false;
        if (error) {
            console.error(`Backup exec error: ${error.message}`, stderr);
            // Clean up partial file if it exists
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            return res.status(500).json({ message: 'Failed to create backup. Please check server logs.' });
        }
        res.status(201).json({ message: 'Backup created successfully!', filename });
    });
});

// POST /api/backups/upload - Upload an external backup file (.sql.gz or .sql)
router.post('/upload', protect, hasPermission('backups:create'), upload.single('file'), (req, res) => {
    if (isOperationInProgress) {
        return res.status(409).json({ message: 'A backup or restore operation is already in progress. Please wait.' });
    }

    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ message: 'Please select a backup file to upload.' });
    }

    const originalName = req.file.originalname || '';
    const buffer = req.file.buffer;

    // Validate extension
    const isGzipExt = originalName.toLowerCase().endsWith('.sql.gz') || originalName.toLowerCase().endsWith('.gz');
    const isSqlExt = originalName.toLowerCase().endsWith('.sql');

    if (!isGzipExt && !isSqlExt) {
        return res.status(400).json({ message: 'Invalid file extension. Only .sql.gz and .sql files are allowed.' });
    }

    // Magic bytes verification for gzip (0x1f 0x8b)
    const isGzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

    if (isGzipExt && !isGzipMagic) {
        return res.status(400).json({ message: 'File header mismatch. Uploaded file is not a valid gzipped backup or SQL dump.' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `forson-db-upload-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });

        if (isGzipMagic) {
            // Write validated gzipped backup file directly
            fs.writeFileSync(filepath, buffer, { mode: 0o644 });
        } else if (isSqlExt) {
            // Compress raw SQL dump on the fly into .sql.gz
            const gzipped = zlib.gzipSync(buffer);
            fs.writeFileSync(filepath, gzipped, { mode: 0o644 });
        } else {
            return res.status(400).json({ message: 'File header mismatch. Uploaded file is not a valid gzipped backup or SQL dump.' });
        }

        res.status(201).json({
            message: 'Backup file uploaded successfully!',
            filename,
            size: fs.statSync(filepath).size
        });
    } catch (err) {
        console.error('Failed to save uploaded backup file:', err);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        res.status(500).json({ message: 'Failed to save uploaded backup file.' });
    }
});

// POST /api/backups/restore - Restore from a backup
router.post('/restore', protect, hasPermission('backups:restore'), (req, res) => {
    if (isOperationInProgress) {
        return res.status(409).json({ message: 'A backup or restore operation is already in progress. Please wait.' });
    }

    const { filename } = req.body;
    const filepath = safePath(filename);
    if (!filepath) {
        return res.status(400).json({ message: 'Valid backup filename is required (must end with .sql.gz and match backup format).' });
    }
    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ message: 'Backup file not found.' });
    }

    isOperationInProgress = true;

    // The dump is plain SQL + gzip (created with --clean --if-exists).
    // gunzip -c pipes the decompressed SQL into psql.
    const command = `gunzip -c "${filepath}" | psql "${pgUrl()}"`;

    exec(command, { env: pgEnv() }, (error, stdout, stderr) => {
        isOperationInProgress = false;
        if (error) {
            console.error(`Restore exec error: ${error.message}`, stderr);
            return res.status(500).json({ message: 'Failed to restore database. Please check server logs.' });
        }
        res.status(200).json({ message: `Database restored successfully from ${filename}.` });
    });
});

// GET /api/backups/:filename - Download a backup file
router.get('/:filename', protect, hasPermission('backups:view'), (req, res) => {
    const filePath = safePath(req.params.filename);
    if (!filePath) return res.status(400).send('Invalid filename.');
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ message: 'Backup file not found.' });
    }
});

// DELETE /api/backups/:filename - Delete a backup file
router.delete('/:filename', protect, hasPermission('backups:delete'), (req, res) => {
    const filePath = safePath(req.params.filename);
    if (!filePath) return res.status(400).send('Invalid filename.');
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error('Failed to delete backup file:', err);
                return res.status(500).json({ message: 'Failed to delete backup.' });
            }
            res.json({ message: 'Backup deleted successfully.' });
        });
    } else {
        res.status(404).json({ message: 'Backup file not found.' });
    }
});

module.exports = router;



