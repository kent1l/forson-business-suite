-- Managers explicitly select which cycle-count executors receive automatic batches.
-- An empty list is deliberate: automatic generation should not assign work until
-- the manager has opted staff in from the Cycle Count Controls screen.
INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('CYCLE_COUNT_AUTO_ASSIGN_EMPLOYEE_IDS', '[]', 'Employee IDs eligible for automatic cycle-count batch assignment')
ON CONFLICT (setting_key) DO NOTHING;
