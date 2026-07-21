const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Set test BACKUP_DIR before requiring backupRoutes
const TEST_BACKUP_DIR = path.join(__dirname, 'tmp_backups');
process.env.BACKUP_DIR = TEST_BACKUP_DIR;

// Mock 'pg' and '../db' to avoid holding open DB handles in tests
jest.mock('pg', () => {
    const mPool = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool), Client: jest.fn() };
});

jest.mock('../db', () => ({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn(),
}));

// Mock authMiddleware before requiring backupRoutes
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => next(),
    hasPermission: () => (req, res, next) => next(),
}));

const backupRoutes = require('../routes/backupRoutes');

describe('backupRoutes Security & Logic', () => {
    let app;

    beforeAll(() => {
        fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
    });

    afterAll(() => {
        if (fs.existsSync(TEST_BACKUP_DIR)) {
            fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/backups', backupRoutes);
    });

    describe('POST /api/backups/upload', () => {
        it('should return 400 if no file attached', async () => {
            const res = await request(app).post('/api/backups/upload');
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/select a backup file/i);
        });

        it('should reject invalid file extensions like .sh or .exe', async () => {
            const res = await request(app)
                .post('/api/backups/upload')
                .attach('file', Buffer.from('echo 123'), 'script.sh');

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Only .sql.gz and .sql files are allowed/);
        });

        it('should reject .sql.gz files missing gzip magic header bytes', async () => {
            const res = await request(app)
                .post('/api/backups/upload')
                .attach('file', Buffer.from('NOT A GZIP FILE CONTENT'), 'backup.sql.gz');

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/File header mismatch/);
        });

        it('should accept valid gzipped backup file', async () => {
            const fakeGzip = zlib.gzipSync(Buffer.from('CREATE TABLE test (id int);'));
            const res = await request(app)
                .post('/api/backups/upload')
                .attach('file', fakeGzip, 'valid-backup.sql.gz');

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Backup file uploaded successfully!');
            expect(res.body.filename).toMatch(/^forson-db-upload-.*\.sql\.gz$/);

            const createdPath = path.join(TEST_BACKUP_DIR, res.body.filename);
            expect(fs.existsSync(createdPath)).toBe(true);
            if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath);
        });

        it('should accept plain .sql file and compress it to .sql.gz', async () => {
            const res = await request(app)
                .post('/api/backups/upload')
                .attach('file', Buffer.from('SELECT 1;'), 'dump.sql');

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Backup file uploaded successfully!');
            expect(res.body.filename).toMatch(/^forson-db-upload-.*\.sql\.gz$/);

            const createdPath = path.join(TEST_BACKUP_DIR, res.body.filename);
            expect(fs.existsSync(createdPath)).toBe(true);
            if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath);
        });
    });

    describe('POST /api/backups/restore', () => {
        it('should reject shell command injection attempts with HTTP 400', async () => {
            const res = await request(app)
                .post('/api/backups/restore')
                .send({ filename: '"; touch /tmp/hacked; "' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Valid backup filename is required/);
        });

        it('should reject path traversal attempts with HTTP 400', async () => {
            const res = await request(app)
                .post('/api/backups/restore')
                .send({ filename: '../../etc/passwd' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Valid backup filename is required/);
        });

        it('should reject filenames with invalid extension or structure', async () => {
            const res = await request(app)
                .post('/api/backups/restore')
                .send({ filename: 'backup-1234.sh' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Valid backup filename is required/);
        });

        it('should return 404 for validly named but non-existent backup files', async () => {
            const res = await request(app)
                .post('/api/backups/restore')
                .send({ filename: 'backup-2026-01-01T00-00-00.sql.gz' });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Backup file not found.');
        });
    });

    describe('GET /api/backups/:filename download validation', () => {
        it('should reject downloading arbitrary invalid filenames', async () => {
            const res = await request(app).get('/api/backups/invalid_name.txt');
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/backups/:filename delete validation', () => {
        it('should reject deleting arbitrary invalid filenames', async () => {
            const res = await request(app).delete('/api/backups/invalid_name.txt');
            expect(res.status).toBe(400);
        });
    });
});
