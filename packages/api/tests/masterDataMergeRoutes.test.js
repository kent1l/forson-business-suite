const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        if (!req.headers.authorization) return res.status(401).json({ message: 'Unauthorized' });
        req.user = { employee_id: 7, permissions: req.headers['x-test-permissions']?.split(',') || [] };
        return next();
    },
    hasPermission: permission => (req, res, next) => req.user.permissions.includes(permission)
        ? next() : res.status(403).json({ message: 'Forbidden' }),
}));
jest.mock('../services/partyMergeService', () => jest.fn().mockImplementation(() => ({
    preview: jest.fn().mockResolvedValue({ fingerprint: 'review' }),
    execute: jest.fn().mockResolvedValue({ operationId: 'merged' }),
    revert: jest.fn().mockResolvedValue({ restoredIds: [2] }),
    history: jest.fn().mockResolvedValue([]),
})));

const partyMergeRoutes = require('../routes/partyMergeRoutes');
const PartyMergeService = require('../services/partyMergeService');

describe('master-data merge route rollout and authorization', () => {
    const original = process.env.ENABLE_SAFE_MASTER_DATA_MERGE;
    const app = express();
    app.use(express.json());
    app.use('/api', partyMergeRoutes({}, 'supplier'));
    afterAll(() => {
        if (original === undefined) delete process.env.ENABLE_SAFE_MASTER_DATA_MERGE;
        else process.env.ENABLE_SAFE_MASTER_DATA_MERGE = original;
    });

    test('authentication and permission are required before review or execution', async () => {
        process.env.ENABLE_SAFE_MASTER_DATA_MERGE = 'execute';
        await request(app).post('/api/suppliers/merge-preview').send({}).expect(401);
        await request(app).post('/api/suppliers/merge').set('Authorization', 'Bearer test').send({}).expect(403);
        expect(PartyMergeService.mock.results[0].value.execute).not.toHaveBeenCalled();
    });

    test('preview stage permits review but blocks merge and revert', async () => {
        process.env.ENABLE_SAFE_MASTER_DATA_MERGE = 'preview';
        const auth = { Authorization: 'Bearer test', 'x-test-permissions': 'suppliers:edit' };
        await request(app).post('/api/suppliers/merge-preview').set(auth).send({}).expect(200);
        await request(app).post('/api/suppliers/merge').set(auth).send({}).expect(503);
        await request(app).post('/api/suppliers/merge-history/123/revert').set(auth).send({ reason: 'test' }).expect(503);
        expect(PartyMergeService.mock.results[0].value.execute).not.toHaveBeenCalled();
    });

    test('execute stage uses the single shared merge route', async () => {
        process.env.ENABLE_SAFE_MASTER_DATA_MERGE = 'execute';
        await request(app).post('/api/suppliers/merge')
            .set('Authorization', 'Bearer test').set('x-test-permissions', 'suppliers:edit')
            .send({ keepId: 1, mergeIds: [2] }).expect(200);
        expect(PartyMergeService.mock.results[0].value.execute).toHaveBeenCalledWith(
            { keepId: 1, mergeIds: [2] }, 7);
    });
});
