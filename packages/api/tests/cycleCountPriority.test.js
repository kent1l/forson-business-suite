jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const db = require('../db');
const { generateCycleCountBatches } = require('../services/cycleCountService');

test('cycle-count priority multiplies count age, velocity, cost, and adjustment risk', async () => {
    const client = {
        query: jest.fn((sql) => {
            if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql)) return Promise.resolve({});
            if (/FROM settings/i.test(sql)) return Promise.resolve({ rows: [
                { setting_key: 'CYCLE_COUNT_ENABLED', setting_value: 'true' },
                { setting_key: 'CYCLE_COUNT_COST_WEIGHT', setting_value: '0.02' },
                { setting_key: 'CYCLE_COUNT_ADJUSTMENT_MULTIPLIER', setting_value: '3' },
                { setting_key: 'CYCLE_COUNT_AUTO_ASSIGN_EMPLOYEE_IDS', setting_value: '[1]' },
            ] });
            if (/SELECT DISTINCT e\.employee_id/i.test(sql)) return Promise.resolve({ rows: [{ employee_id: 1 }] });
            if (/WITH part_metrics/i.test(sql)) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await generateCycleCountBatches();

    const [sql, params] = client.query.mock.calls.find(([query]) => /WITH part_metrics/i.test(query));
    expect(sql).toContain('NULLIF(p.wac_cost, 0)');
    expect(sql).toContain('has_adjustment_since_count');
    expect(sql).toContain("'Cycle Count Auto-Adjustment'");
    expect(sql).toContain('GREATEST(1, unit_cost * $3)');
    expect(params).toEqual([1, 5, 0.02, 3, 1000]);
    const [, employeeParams] = client.query.mock.calls.find(([query]) => /SELECT DISTINCT e\.employee_id/i.test(query));
    expect(employeeParams).toEqual([[1]]);
    expect(client.release).toHaveBeenCalled();
});

test('cycle-count assignment excludes employees on approved leave today in Manila', async () => {
    const client = {
        query: jest.fn((sql) => {
            if (/^BEGIN/i.test(sql) || /^ROLLBACK/i.test(sql)) return Promise.resolve({});
            if (/FROM settings/i.test(sql)) return Promise.resolve({ rows: [
                { setting_key: 'CYCLE_COUNT_ENABLED', setting_value: 'true' },
                { setting_key: 'CYCLE_COUNT_AUTO_ASSIGN_EMPLOYEE_IDS', setting_value: '[1]' },
            ] });
            if (/SELECT DISTINCT e\.employee_id/i.test(sql)) return Promise.resolve({ rows: [] });
            return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
    };
    db.getClient.mockResolvedValue(client);

    await generateCycleCountBatches();

    const [sql] = client.query.mock.calls.find(([query]) => /SELECT DISTINCT e\.employee_id/i.test(query));
    expect(sql).toContain('FROM leave_request lr');
    expect(sql).toContain("lr.status = 'Approved'");
    expect(sql).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'");
    expect(sql).toContain('BETWEEN lr.date_from AND lr.date_to');
});
