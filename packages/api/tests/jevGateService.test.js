const JevGateService = require('../services/jevGateService');

describe('JevGateService', () => {
    test('does not query local data when Jev is not configured', async () => {
        const db = { query: jest.fn() };
        const service = new JevGateService({ db, jevClient: { isConfigured: () => false } });

        await expect(service.chooseExistingBrand('Acme')).resolves.toBeNull();
        await expect(service.findPartDuplicate({ detail: 'Brake pad' })).resolves.toBeNull();
        expect(db.query).not.toHaveBeenCalled();
    });

    test('returns a brand only for an allowed high-confidence Choice response', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }] }) };
        const jevClient = {
            isConfigured: () => true,
            evaluateChoice: jest.fn().mockResolvedValue({ choice: '7', confidence: 0.95, model: 'jev-test' }),
        };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.chooseExistingBrand('ACME')).resolves.toEqual({
            record: { brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }, confidence: 0.95, model: 'jev-test',
        });
        expect(jevClient.evaluateChoice).toHaveBeenCalledWith(expect.objectContaining({ question: 'brand' }));
    });

    test('requires a local party candidate and a high Noul probability before blocking', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ entity_id: 3, entity_name: 'Acme Supply', entity_code: 'SUP-3' }] }) };
        const jevClient = {
            isConfigured: () => true,
            evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.93, model: 'jev-test' }),
        };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.findPartyDuplicate('supplier', 'ACME SUPPLY INC')).resolves.toEqual({
            record: { entity_id: 3, entity_name: 'Acme Supply', entity_code: 'SUP-3' }, confidence: 0.93, model: 'jev-test',
        });
        expect(db.query.mock.calls[0][0]).toContain('similarity');
    });

    test('fails open when Meilisearch or Jev cannot evaluate a part candidate', async () => {
        const logger = { warn: jest.fn() };
        const service = new JevGateService({
            db: { query: jest.fn() }, logger,
            jevClient: { isConfigured: () => true },
            meiliClient: { index: () => ({ search: jest.fn().mockRejectedValue(new Error('offline')) }) },
        });
        await expect(service.findPartDuplicate({ detail: 'Brake pad' })).resolves.toBeNull();
        expect(logger.warn).toHaveBeenCalled();
    });
});
