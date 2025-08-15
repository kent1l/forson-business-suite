const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { protect, isAdmin } = require('../middleware/authMiddleware');
const router = express.Router();

// Define the path to the backups directory, which is mounted by Docker.
const BACKUP_DIR = path.join(__dirname, '../../../../backups');

// Helper function to sanitize filenames and prevent path traversal attacks.
const sanitizeFilename = (filename) => {
    if (filename.includes('/') || filename.includes('..')) {
        throw new Error('Invalid filename provided.');
    }
    return filename;
};

// GET /api/backups - List all available backup files.
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        const backupFiles = files
            .filter(file => file.endsWith('.sql.gz'))
            .map(async (file) => {
                const stats = await fs.stat(path.join(BACKUP_DIR, file));
                return {
                    filename: file,
                    size: stats.size,
                    createdAt: stats.birthtime,
                };
            });

        const detailedFiles = await Promise.all(backupFiles);
        // Sort files by creation date, with the newest backup first.
        detailedFiles.sort((a, b) => b.createdAt - a.createdAt);

        res.json(detailedFiles);
    } catch (error) {
        // If the backup directory doesn't exist yet, return an empty array instead of an error.
        if (error.code === 'ENOENT') {
            return res.json([]);
        }
        console.error('Error listing backups:', error);
        res.status(500).json({ message: 'Failed to list backups.' });
    }
});

// POST /api/backups - Trigger an on-demand backup.
router.post('/', protect, isAdmin, (req, res) => {
    // This command executes the backup script inside the running 'forson_backup' container.
    const command = 'docker exec forson_backup /docker-entrypoint-initdb.d/backup.sh';

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Backup execution error: ${error.message}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ message: 'Failed to create backup.', error: stderr });
        }
        console.log(`stdout: ${stdout}`);
        res.status(201).json({ message: 'Backup created successfully.' });
    });
});

// POST /api/backups/restore - Restore the database from a specified backup file.
router.post('/restore', protect, isAdmin, (req, res) => {
    const { filename } = req.body;
    if (!filename) {
        return res.status(400).json({ message: 'Filename is required for restore operation.' });
    }

    try {
        const safeFilename = sanitizeFilename(filename);
        const backupFilePath = `/backups/${safeFilename}`;

        // This command runs pg_restore inside the backup container, which has the necessary tools
        // and network access to the database container ('db').
        // --clean: Drops database objects before recreating them.
        // --if-exists: Prevents errors if an object to be dropped doesn't exist.
        const command = `docker exec forson_backup bash -c "PGPASSWORD=$DB_PASSWORD pg_restore -h db -U $DB_USER -d $DB_NAME --clean --if-exists ${backupFilePath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Restore execution error: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                return res.status(500).json({ message: 'Failed to restore database.', error: stderr });
            }
            console.log(`stdout: ${stdout}`);
            res.status(200).json({ message: `Database restored successfully from ${safeFilename}.` });
        });

    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});


// DELETE /api/backups/:filename - Delete a specific backup file.
router.delete('/:filename', protect, isAdmin, async (req, res) => {
    try {
        const safeFilename = sanitizeFilename(req.params.filename);
        const filePath = path.join(BACKUP_DIR, safeFilename);

        await fs.access(filePath); // Check if file exists.
        await fs.unlink(filePath); // Delete the file.

        res.json({ message: `Backup file '${safeFilename}' deleted successfully.` });
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ message: 'Backup file not found.' });
        }
        console.error('Error deleting backup:', error);
        res.status(500).json({ message: 'Failed to delete backup file.' });
    }
});

module.exports = router;
