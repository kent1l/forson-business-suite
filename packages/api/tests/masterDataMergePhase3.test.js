const MasterDataMergeService = require('../services/masterDataMergeService');
const { requireActiveMasters, hasMasterIds } = require('../helpers/masterDataStatus');

describe('master data merge preview confirmation', () => {
    const originalSecret = process.env.JWT_SECRET;
    beforeAll(() => { process.env.JWT_SECRET = 'phase-three-test-secret'; });
    afterAll(() => {
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    });

    test('binds the token to its fingerprint and rejects expired or tampered tokens', () => {
        const service = new MasterDataMergeService({}, 'supplier');
        const fingerprint = 'a'.repeat(64);
        const request = { previewFingerprint: fingerprint, previewToken: service.previewToken(fingerprint, Date.now()) };
        expect(() => service.assertPreviewToken(request)).not.toThrow();
        expect(() => service.assertPreviewToken({ ...request, previewFingerprint: 'b'.repeat(64) }))
            .toThrow('invalid');
        expect(() => service.assertPreviewToken({ ...request, previewToken: service.previewToken(fingerprint, Date.now() - 11 * 60 * 1000) }))
            .toThrow('expired');
    });

    test('requires historical-document acknowledgment before starting a transaction', async () => {
        const service = new MasterDataMergeService({}, 'customer');
        const fingerprint = 'a'.repeat(64);
        await expect(service.execute({ keepId: 1, mergeIds: [2], previewFingerprint: fingerprint,
            previewToken: service.previewToken(fingerprint, Date.now()) }, 1))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    test('requires a revert reason before touching the database', async () => {
        const client = { query: jest.fn() };
        const service = new MasterDataMergeService({}, 'brand');
        await expect(service.revertWithClient(client, '12345678-1234-1234-1234-123456789abc', 1, '  '))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(client.query).not.toHaveBeenCalled();
    });
});

describe('stale transaction IDs', () => {
    test('finds typed IDs in nested draft and freight payloads', () => {
        expect(hasMasterIds({ header: { freight_costs: [{ supplier_id: '7' }] } })).toBe(true);
        expect(hasMasterIds({ notes: 'supplier_id: 7' })).toBe(false);
    });

    test('returns the canonical ID before a document write', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 7, is_active: false, is_merged: true, canonical_id: 3 }] }) };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        await requireActiveMasters(db, { supplier_id: 'supplier' })(
            { method: 'POST', body: { supplier_id: 7 } }, res, next);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: 3, retiredId: 7 }));
        expect(next).not.toHaveBeenCalled();
    });
});
