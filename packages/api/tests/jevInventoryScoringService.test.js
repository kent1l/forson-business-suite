jest.mock('../db', () => ({ query: jest.fn() }));

const { JevInventoryScoringService } = require('../services/jevInventoryScoringService');

test('scores only bounded ordinary candidates and persists confident Jev decisions', async () => {
    const database = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ part_id: 1, display_name: 'Oil Filter', stock_on_hand: 4 }] })
        .mockResolvedValueOnce({ rows: [{ part_id: 2, display_name: 'Brake Pad', stock_on_hand: 0 }] })
        .mockResolvedValue({ rows: [] }) };
    const client = {
        isConfigured: jest.fn(() => true),
        evaluateScore: jest.fn().mockResolvedValue({ score: 2, confidence: 0.93, model: 'typesafe/jev-test' }),
    };
    const service = new JevInventoryScoringService({ database, client, env: { JEV_INVENTORY_SCORE_MAX_CANDIDATES: '5' }, logger: { warn: jest.fn() } });

    await expect(service.refresh()).resolves.toEqual({ cycleCount: 1, reorder: 1, skipped: false });
    expect(client.evaluateScore).toHaveBeenCalledTimes(2);
    const writes = database.query.mock.calls.filter(([sql]) => /INSERT INTO public\.jev_inventory_score/i.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes[0][1]).toEqual(expect.arrayContaining([1, 'cycle_count', 2, 0.93]));
    expect(writes[1][1]).toEqual(expect.arrayContaining([2, 'reorder', 2, 0.93]));
});

test('does not call Jev for hard cycle-count overrides', async () => {
    const database = { query: jest.fn() };
    const client = { isConfigured: jest.fn(() => true), evaluateScore: jest.fn() };
    const service = new JevInventoryScoringService({ database, client, logger: { warn: jest.fn() } });

    await expect(service.scoreRows('cycle_count', [
        { part_id: 1, audit_requested: true, stock_on_hand: 10 },
        { part_id: 2, audit_requested: false, stock_on_hand: -1 },
    ])).resolves.toBe(0);
    expect(client.evaluateScore).not.toHaveBeenCalled();
});

test('reuses a fresh score when the candidate facts have not changed', async () => {
    const database = { query: jest.fn((sql) => {
        if (/SELECT 1 FROM public\.jev_inventory_score/i.test(sql)) return Promise.resolve({ rows: [{ '?column?': 1 }] });
        return Promise.resolve({ rows: [] });
    }) };
    const client = { isConfigured: jest.fn(() => true), evaluateScore: jest.fn(), config: { model: 'typesafe/jev-test' } };
    const service = new JevInventoryScoringService({ database, client, logger: { warn: jest.fn() } });

    await expect(service.scoreRows('reorder', [{ part_id: 4, display_name: 'Oil Filter', stock_on_hand: 0 }])).resolves.toBe(0);
    expect(client.evaluateScore).not.toHaveBeenCalled();
});
