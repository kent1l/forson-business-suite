const JevGateService = require('../services/jevGateService');

describe('JevGateService', () => {
    test('does not call Jev when it is not configured', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        const service = new JevGateService({ db, jevClient: { isConfigured: () => false } });

        await expect(service.chooseExistingBrand('Acme')).resolves.toBeNull();
        await expect(service.findPartDuplicate({ detail: 'Brake pad' })).resolves.toBeNull();
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('returns a brand only for an allowed high-confidence Choice response', async () => {
        const db = { query: jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }] }) };
        const jevClient = {
            isConfigured: () => true,
            evaluateChoice: jest.fn().mockResolvedValue({ choice: '7', confidence: 0.95, model: 'jev-test' }),
        };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.chooseExistingBrand('Acme Turbo')).resolves.toEqual({
            record: { brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }, confidence: 0.95, model: 'jev-test', action: 'reuse',
        });
        expect(jevClient.evaluateChoice).toHaveBeenCalledWith(expect.objectContaining({ question: 'brand' }));
    });

    test('uses an exact local brand match without spending a Jev request', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }] }) };
        const jevClient = { isConfigured: () => true, evaluateChoice: jest.fn() };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.chooseExistingBrand('  ACME  ')).resolves.toMatchObject({
            record: { brand_id: 7 }, confidence: 1, model: 'local-exact-match',
        });
        expect(jevClient.evaluateChoice).not.toHaveBeenCalled();
    });

    test('requires a local party candidate and a high Noul probability before blocking', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ entity_id: 3, entity_name: 'Acme Supply', entity_code: 'SUP-3' }] }) };
        const jevClient = {
            isConfigured: () => true,
            evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.93, model: 'jev-test' }),
        };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.findPartyDuplicate('supplier', 'ACME SUPPLY INC')).resolves.toEqual({
            record: { entity_id: 3, entity_name: 'Acme Supply', entity_code: 'SUP-3' }, confidence: 0.93, model: 'jev-test', action: 'block',
        });
        expect(db.query.mock.calls[0][0]).toContain('similarity');
    });

    test('returns a confirmation action for a Choice result in the configured mid-band', async () => {
        const db = { query: jest.fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ brand_id: 7, brand_name: 'Acme', brand_code: 'AC' }] }) };
        const jevClient = { isConfigured: () => true, evaluateChoice: jest.fn().mockResolvedValue({ choice: '7', confidence: 0.84, model: 'jev-test' }) };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.chooseExistingBrand('Acme Turbo')).resolves.toMatchObject({
            record: { brand_id: 7 }, confidence: 0.84, action: 'confirm',
        });
    });

    test('returns a confirmation action for a Noul result in the configured mid-band', async () => {
        const db = { query: jest.fn().mockResolvedValue({ rows: [{ entity_id: 3, entity_name: 'Acme Supply', entity_code: 'SUP-3' }] }) };
        const jevClient = { isConfigured: () => true, evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.84, model: 'jev-test' }) };
        const service = new JevGateService({ db, jevClient, env: {} });

        await expect(service.findPartyDuplicate('supplier', 'Acme Turbo Supply')).resolves.toMatchObject({
            record: { entity_id: 3 }, confidence: 0.84, action: 'confirm',
        });
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

    test('excludes candidates from duplicate evaluation when canonical brands differ', async () => {
        const db = {
            query: jest.fn()
                .mockImplementation(async (sql, params) => {
                    if (sql.includes('SELECT p.part_id')) {
                        return { rows: [{ part_id: 101, brand_id: 2, brand_name: 'Denso', is_merged: false, detail: 'Brake pad' }] };
                    }
                    if (sql.includes('SELECT brand_id')) {
                        if (params[0] === 1) return { rows: [{ brand_id: 1, brand_name: 'Bosch', is_merged: false }] };
                        if (params[0] === 2) return { rows: [{ brand_id: 2, brand_name: 'Denso', is_merged: false }] };
                    }
                    return { rows: [] };
                })
        };
        const jevClient = { isConfigured: () => true, evaluateDuplicate: jest.fn() };
        const meiliClient = {
            index: () => ({
                search: jest.fn().mockResolvedValue({
                    hits: [{ part_id: 101, detail: 'Brake pad', brand_id: 2, brand_name: 'Denso', is_active: true }]
                })
            })
        };
        const service = new JevGateService({ db, jevClient, meiliClient, env: {} });

        const result = await service.findPartDuplicate({ detail: 'Brake pad', brand_id: 1 });
        expect(result).toBeNull();
        expect(jevClient.evaluateDuplicate).not.toHaveBeenCalled();
    });

    test('evaluates candidates that share the same canonical brand or alias and marks bands', async () => {
        const db = {
            query: jest.fn()
                .mockImplementation(async (sql, params) => {
                    if (sql.includes('SELECT p.part_id')) {
                        return { rows: [{ part_id: 101, brand_id: 12, brand_name: 'Bosch Auto', is_merged: true, merged_into_brand_id: 1, detail: 'Brake pad' }] };
                    }
                    if (sql.includes('SELECT brand_id')) {
                        if (params[0] === 1) return { rows: [{ brand_id: 1, brand_name: 'Bosch', is_merged: false }] };
                        if (params[0] === 12) return { rows: [{ brand_id: 12, brand_name: 'Bosch Auto', is_merged: true, merged_into_brand_id: 1 }] };
                    }
                    return { rows: [] };
                })
        };
        const jevClient = {
            isConfigured: () => true,
            evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.95, model: 'jev-test' }),
        };
        const meiliClient = {
            index: () => ({
                search: jest.fn().mockResolvedValue({
                    hits: [{ part_id: 101, detail: 'Brake pad', brand_id: 12, brand_name: 'Bosch Auto', is_active: true }]
                })
            })
        };
        const service = new JevGateService({ db, jevClient, meiliClient, env: {} });

        const result = await service.findPartDuplicate({ detail: 'Brake pad', brand_id: 1 });
        expect(result).toMatchObject({
            record: expect.objectContaining({ entity_id: 101 }),
            confidence: 0.95,
            band: 'high',
            action: 'confirm', // Actionable for parts!
        });
    });

    test('returns medium band for 0.85 confidence part match', async () => {
        const db = {
            query: jest.fn().mockResolvedValue({ rows: [{ part_id: 101, brand_id: 1, brand_name: 'Bosch', is_merged: false, detail: 'Brake pad' }] })
        };
        const jevClient = {
            isConfigured: () => true,
            evaluateDuplicate: jest.fn().mockResolvedValue({ probability: 0.85, model: 'jev-test' }),
        };
        const meiliClient = {
            index: () => ({
                search: jest.fn().mockResolvedValue({
                    hits: [{ part_id: 101, detail: 'Brake pad', brand_id: 1, brand_name: 'Bosch', is_active: true }]
                })
            })
        };
        const service = new JevGateService({ db, jevClient, meiliClient, env: {} });

        const result = await service.findPartDuplicate({ detail: 'Brake pad', brand_id: 1 });
        expect(result).toMatchObject({
            confidence: 0.85,
            band: 'medium',
            action: 'confirm',
        });
    });
});
