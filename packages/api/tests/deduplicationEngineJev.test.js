jest.mock('../services/llmRouter', () => ({ analyzeGroup: jest.fn() }));
jest.mock('../services/jevClient', () => jest.fn().mockImplementation(() => ({
    isConfigured: jest.fn(() => true),
    evaluateNoul: jest.fn(),
})));

const llmRouter = require('../services/llmRouter');
const JevClient = require('../services/jevClient');
const DeduplicationEngine = require('../services/deduplicationEngine');

test('Jev clear non-match pre-filter skips the free group LLM and caches pairs', async () => {
    const jev = JevClient.mock.results[0].value;
    jev.evaluateNoul.mockResolvedValue({ probability: 0.02, model: 'typesafe/jev-test' });
    const db = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] }) };
    const engine = new DeduplicationEngine(db);

    await expect(engine.analyzeClusterWithAI([
        { part_id: 4, display_name: 'Oil filter', part_numbers: [] },
        { part_id: 9, display_name: 'Brake pad', part_numbers: [] },
    ])).resolves.toEqual([]);

    expect(jev.evaluateNoul).toHaveBeenCalledWith(expect.objectContaining({ question: 'cluster_contains_duplicate' }));
    expect(llmRouter.analyzeGroup).not.toHaveBeenCalled();
    const cacheWrite = db.query.mock.calls.find(([sql]) => /JEV_PREFILTER/.test(sql));
    expect(cacheWrite[1]).toEqual([4, 9, expect.stringContaining('0.02')]);
});

test('uncertain Jev pre-filter preserves the explainable free-LLM path', async () => {
    const jev = JevClient.mock.results[0].value;
    jev.evaluateNoul.mockResolvedValue({ probability: 0.50, model: 'typesafe/jev-test' });
    llmRouter.analyzeGroup.mockResolvedValue({ skipped: true, groups: [] });
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await expect(new DeduplicationEngine(db).analyzeClusterWithAI([
        { part_id: 1, display_name: 'Filter', part_numbers: [] },
        { part_id: 2, display_name: 'Filter 2', part_numbers: [] },
    ])).resolves.toEqual([]);
    expect(llmRouter.analyzeGroup).toHaveBeenCalled();
});
