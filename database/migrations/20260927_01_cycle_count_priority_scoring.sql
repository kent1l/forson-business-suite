-- Phase 3 local-first cycle-count scoring controls. Existing deployments need
-- these rows because initial schema seeding is not reapplied during upgrades.
INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('CYCLE_COUNT_COST_WEIGHT', '0.01', 'Cycle-count priority multiplier per peso of unit cost'),
    ('CYCLE_COUNT_ADJUSTMENT_MULTIPLIER', '2', 'Cycle-count priority multiplier after an adjustment since the last count')
ON CONFLICT (setting_key) DO NOTHING;
