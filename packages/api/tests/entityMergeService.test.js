const EntityMergeService = require('../services/entityMergeService');

describe('EntityMergeService', () => {
    const makeClient = () => ({ query: jest.fn(), release: jest.fn() });

    test('lists only active entities with their part usage counts', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ brand_id: 1, part_count: 3 }] }) };
        const service = new EntityMergeService(db, 'brand');

        await expect(service.list()).resolves.toEqual([{ brand_id: 1, part_count: 3 }]);
        expect(db.query.mock.calls[0][0]).toContain('WHERE NOT e.is_merged');
        expect(db.query.mock.calls[0][0]).toContain('COUNT(p.part_id)::int AS part_count');
    });

    test('rejects invalid merge identifiers before opening a transaction', async () => {
        const db = { getClient: jest.fn() };
        const service = new EntityMergeService(db, 'group');

        await expect(service.execute({ keepId: 0, mergeIds: [2] }, 10)).rejects.toMatchObject({ statusCode: 400 });
        await expect(service.execute({ keepId: 1, mergeIds: [2], suggestionIds: '3' }, 10)).rejects.toMatchObject({ statusCode: 400 });
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('reassigns parts, preserves aliases, resolves selected suggestions, and dismisses stale ones', async () => {
        const client = makeClient();
        client.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // advisory lock 1
            .mockResolvedValueOnce({}) // advisory lock 2
            .mockResolvedValueOnce({ rows: [
                { brand_id: 1, brand_name: 'ACME', brand_code: 'AC', is_merged: false, merged_into_brand_id: null },
                { brand_id: 2, brand_name: 'ACME Parts', brand_code: 'ACP', is_merged: false, merged_into_brand_id: null },
            ] })
            .mockResolvedValueOnce({ rowCount: 4 }) // part reassignment
            .mockResolvedValueOnce({}) // alias insert
            .mockResolvedValueOnce({}) // entity state
            .mockResolvedValueOnce({}) // selected suggestion
            .mockResolvedValueOnce({}) // stale suggestions
            .mockResolvedValueOnce({}); // COMMIT
        const db = { getClient: jest.fn().mockResolvedValue(client) };
        const service = new EntityMergeService(db, 'brand');

        await expect(service.execute({ keepId: 1, mergeIds: [2], suggestionIds: [7] }, 10))
            .resolves.toEqual({ keepId: 1, mergedIds: [2], partsReassigned: 4 });

        const sql = client.query.mock.calls.map(([statement]) => statement).join('\n');
        expect(sql).toContain('INSERT INTO public.brand_alias');
        expect(sql).toContain('SET status = \'merged\'');
        expect(sql).toContain('SET status = \'dismissed\'');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('uses Jev to filter trigram candidates before persisting a suggestion', async () => {
        const client = makeClient();
        client.query
            .mockResolvedValueOnce({ rows: [{ entity_id: 1, duplicate_entity_id: 2, score: 0.67, method: 'pg_trgm', entity_name: 'ACME', entity_code: 'AC', duplicate_entity_name: 'Acme Parts', duplicate_entity_code: 'ACP' }] })
            .mockResolvedValueOnce({ rows: [] }) // decision cache lookup
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // decision cache upsert
            .mockResolvedValueOnce({ rows: [{ suggestion_id: 3 }] })
            .mockResolvedValueOnce({}); // COMMIT
        const jevClient = {
            isConfigured: jest.fn().mockReturnValue(true),
            duplicateDecisionCacheKey: { model: 'typesafe/jev-test', promptVersion: 'duplicate-v1' },
            evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.91, model: 'jev-test' }),
            logger: { warn: jest.fn() },
        };
        const service = new EntityMergeService({ getClient: jest.fn().mockResolvedValue(client) }, 'brand', { jevClient });

        await expect(service.scan({ threshold: 0.55, jevThreshold: 0.8 })).resolves.toMatchObject({
            createdOrUpdated: 1,
            localCandidates: 1,
            jev: { enabled: true, evaluated: 1, rejected: 0, failures: 0 },
        });
        expect(jevClient.evaluateDuplicate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'brand' }));
        const cacheCall = client.query.mock.calls[3];
        expect(cacheCall[0]).toContain('INSERT INTO public.entity_duplicate_decision_cache');
        expect(cacheCall[1]).toEqual(expect.arrayContaining(['brand', 1, 2, 'typesafe/jev-test', 'duplicate-v1', 0.91]));
        const insertCall = client.query.mock.calls[4];
        expect(insertCall[1]).toEqual([1, 2, 0.91, 'pg_trgm+jev', expect.stringContaining('91%')]);
        expect(insertCall[0]).toContain('ON CONFLICT ((LEAST(brand_id, duplicate_brand_id)), (GREATEST(brand_id, duplicate_brand_id)))');
    });

    test('reuses a matching cached decision without calling Jev again', async () => {
        const pair = { entity_id: 1, duplicate_entity_id: 2, score: 0.67, method: 'pg_trgm', entity_name: 'ACME', entity_code: 'AC', duplicate_entity_name: 'Acme Parts', duplicate_entity_code: 'ACP' };
        const client = makeClient();
        const jevClient = {
            isConfigured: jest.fn().mockReturnValue(true),
            duplicateDecisionCacheKey: { model: 'typesafe/jev-test', promptVersion: 'duplicate-v1' },
            evaluateDuplicate: jest.fn(),
            logger: { warn: jest.fn() },
        };
        const service = new EntityMergeService({ getClient: jest.fn().mockResolvedValue(client) }, 'brand', { jevClient });
        client.query
            .mockResolvedValueOnce({ rows: [pair] })
            .mockResolvedValueOnce({ rows: [{
                left_entity_id: 1,
                right_entity_id: 2,
                left_input_fingerprint: service.duplicateInputFingerprint(pair.entity_name, pair.entity_code),
                right_input_fingerprint: service.duplicateInputFingerprint(pair.duplicate_entity_name, pair.duplicate_entity_code),
                model: 'typesafe/jev-test',
                prompt_version: 'duplicate-v1',
                probability: '0.91',
            }] })
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rows: [{ suggestion_id: 3 }] })
            .mockResolvedValueOnce({}); // COMMIT

        await expect(service.scan({ threshold: 0.55, jevThreshold: 0.8 })).resolves.toMatchObject({
            createdOrUpdated: 1,
            jev: { evaluated: 0, cached: 1, rejected: 0 },
        });
        expect(jevClient.evaluateDuplicate).not.toHaveBeenCalled();
        const suggestionCall = client.query.mock.calls[3];
        expect(suggestionCall[1]).toEqual([1, 2, 0.91, 'pg_trgm+jev_cache', expect.stringContaining('Cached Jev')]);
    });
});
