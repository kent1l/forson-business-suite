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
});
