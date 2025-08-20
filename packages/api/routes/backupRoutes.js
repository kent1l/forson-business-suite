const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { protect, hasPermission } = require('../middleware/authMiddleware');
const router = express.Router();

const backupDir = '/backups';

// GET /api/backups - List all available backups
router.get('/', protect, hasPermission('backups:view'), (req, res) => {
    fs.readdir(backupDir, (err, files) => {
        if (err) {
            if (err.code === 'ENOENT') return res.json([]);
            console.error('Failed to read backup directory:', err);
            return res.status(500).json({ message: 'Failed to retrieve backups.' });
        }
        const backups = files
            .filter(file => file.endsWith('.sql.gz'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return { filename: file, size: stats.size, createdAt: stats.mtime };
            })
            .sort((a, b) => b.createdAt - a.createdAt);
        res.json(backups);
    });
});

// POST /api/backups - Create a new on-demand backup
router.post('/', protect, hasPermission('backups:create'), (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `forson-db-manual-${timestamp}.sql.gz`;
    const filepath = path.join(backupDir, filename);
    const command = `pg_dump "postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}" | gzip > ${filepath}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Backup exec error: ${error.message}`);
            return res.status(500).json({ message: `Failed to create backup: ${stderr}` });
        }
        res.status(201).json({ message: 'Backup created successfully!', filename });
    });
});

// POST /api/backups/restore - Restore from a backup
router.post('/restore', protect, hasPermission('backups:restore'), (req, res) => {
    const { filename } = req.body;
    if (!filename || filename.includes('..')) {
        return res.status(400).json({ message: 'Valid filename is required.' });
    }
    const filepath = path.join(backupDir, filename);

    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ message: 'Backup file not found.' });
    }

    const command = `gunzip < ${filepath} | psql "postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Restore exec error: ${error.message}`);
            return res.status(500).json({ message: `Failed to restore database: ${stderr}` });
        }
        res.status(200).json({ message: `Database restored successfully from ${filename}.` });
    });
});


// GET /api/backups/:filename - Download a backup file
router.get('/:filename', protect, hasPermission('backups:view'), (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..')) return res.status(400).send('Invalid filename.');
    const filePath = path.join(backupDir, filename);

    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ message: 'Backup file not found.' });
    }
});

// DELETE /api/backups/:filename - Delete a backup file
router.delete('/:filename', protect, hasPermission('backups:delete'), (req, res) => {
    const { filename } = req.params;
    if (filename.includes('..')) return res.status(400).send('Invalid filename.');
    const filePath = path.join(backupDir, filename);

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
