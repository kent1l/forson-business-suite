jest.mock('../services/ai/core/llmClient', () => ({
    executeWithPool: jest.fn(),
}));

const llmClient = require('../services/ai/core/llmClient');
const resolver = require('../services/ai/features/purchaseOrderParserAI');

const candidate = (score = 0.9, detail = 'NGK CPR8EA-9') => ({
    part_id: 7,
    internal_sku: 'SKU-7',
    detail,
    display_name: detail,
    brand_name: 'NGK',
    group_name: 'Spark Plug',
    last_cost: 120,
    score,
});

describe('purchaseOrderParserAI resolver', () => {
    afterEach(() => jest.restoreAllMocks());

    test('does not call AI for a confident catalog match', async () => {
        jest.spyOn(resolver, '_findPartCandidates').mockResolvedValue([candidate()]);
        const ai = jest.spyOn(resolver, 'parseLine');

        const result = await resolver.resolveLine('10 NGK CPR8EA-9 @ 135');

        expect(ai).not.toHaveBeenCalled();
        expect(result).toMatchObject({ match_status: 'exact', quantity: 10, cost_price: 135 });
    });

    test.each([
        ['5 Motul 10W-40 1L @ 280', []],
        ['5 Motul 10W-40 1L @ 280', [candidate(0.59, 'Motul 3100')]],
        ['1 gal Hypoid Gear Oil @ 480', [candidate(0.9, '1 gal Hypoid Gear Oil')]],
    ])('uses AI only at the documented fallback boundary: %s', async (raw, firstSearch) => {
        jest.spyOn(resolver, '_findPartCandidates')
            .mockResolvedValueOnce(firstSearch)
            .mockResolvedValueOnce([candidate(0.9, 'Motul Gear Oil')]);
        const ai = jest.spyOn(resolver, 'parseLine').mockResolvedValue({
            quantity: 5,
            cost_price: 280,
            brand: 'Motul',
            group: 'Gear Oil',
            detail: 'Motul Gear Oil',
            unit: '1L',
            raw_description: 'Motul Gear Oil',
        });

        const result = await resolver.resolveLine(raw);

        expect(ai).toHaveBeenCalledTimes(1);
        expect(result.match_status).toBe('ai');
    });

    test('the AI prompt explicitly protects product sizes from quantity extraction', async () => {
        llmClient.executeWithPool.mockResolvedValue({
            data: { quantity: null, cost_price: 480, brand: null, group: 'Gear Oil', detail: 'Hypoid Gear Oil', unit: '1 gal', raw_description: '1 gal Hypoid Gear Oil' },
        });

        await resolver.parseLine('1 gal Hypoid Gear Oil @ 480', {});

        expect(llmClient.executeWithPool).toHaveBeenCalledWith('expense_parser_pool', expect.objectContaining({
            prompt: expect.stringMatching(/quantity field is the number of units being ordered[^]*never a product size/i),
        }));
    });

    test('keeps an editable uncataloged draft when AI and catalog matching cannot resolve a line', async () => {
        jest.spyOn(resolver, '_findPartCandidates').mockResolvedValue([]);
        jest.spyOn(resolver, 'parseLine').mockResolvedValue({
            quantity: 2,
            cost_price: 99,
            brand: 'Unknown Brand',
            group: 'Hose',
            detail: 'Special hose',
            unit: '1m',
            raw_description: 'Unknown Brand Special hose 1m',
        });

        const result = await resolver.resolveLine('Unknown Brand Special hose 1m 2pcs @ 99');

        expect(result).toMatchObject({
            match_status: 'unresolved',
            part: null,
            quantity: 2,
            draft_part_data: { brand: 'Unknown Brand', group: 'Hose', detail: 'Special hose', unit: '1m' },
        });
    });
});
