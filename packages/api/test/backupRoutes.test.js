const express = require('express');
const request = require('supertest');

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

    beforeEach(() => {
        app = express();
        app.use(express.json());
        app.use('/api/backups', backupRoutes);
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
