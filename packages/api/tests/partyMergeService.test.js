const PartyMergeService = require('../services/partyMergeService');

describe('PartyMergeService', () => {
    test('rejects invalid or self-referential merge selections before a transaction', () => {
        const service = new PartyMergeService({}, 'customer');
        expect(() => service.validateIds(0, [2])).toThrow('Choose a canonical record');
        expect(() => service.validateIds(1, [1])).toThrow('Choose a canonical record');
    });

    test('uses Jev only to filter supplier trigram candidates and keeps the human review step', async () => {
        const client = { query: jest.fn(), release: jest.fn() };
        client.query
            .mockResolvedValueOnce({ rows: [{ entity_id: 1, duplicate_entity_id: 2, score: 0.7, method: 'pg_trgm', entity_name: 'Acme', entity_code: 'S1', duplicate_entity_name: 'Acme Inc', duplicate_entity_code: 'S2' }] })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ suggestion_id: 1 }] })
            .mockResolvedValueOnce({});
        const jevClient = { isConfigured: jest.fn().mockReturnValue(true), evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.9, model: 'jev-test' }), logger: { warn: jest.fn() } };
        const service = new PartyMergeService({ getClient: jest.fn().mockResolvedValue(client) }, 'supplier', { jevClient });
        await expect(service.scan()).resolves.toMatchObject({ createdOrUpdated: 1, jev: { enabled: true, evaluated: 1 } });
        expect(jevClient.evaluateDuplicate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'supplier' }));
        expect(client.query.mock.calls[2][0]).toContain('supplier_duplicate_suggestion');
    });
});
