CREATE TABLE IF NOT EXISTS cycle_count_batch (
    batch_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employee(employee_id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS cycle_count_line (
    line_id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES cycle_count_batch(batch_id) ON DELETE CASCADE,
    part_id INTEGER REFERENCES part(part_id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    system_qty_snapshot DECIMAL(12, 4),
    counted_qty DECIMAL(12, 4),
    is_unassigned_find BOOLEAN DEFAULT FALSE,
    counted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS part_inventory_stats (
    part_id INTEGER PRIMARY KEY REFERENCES part(part_id),
    last_counted_at TIMESTAMP WITH TIME ZONE,
    audit_requested BOOLEAN DEFAULT FALSE
);

INSERT INTO permission (permission_key, description) VALUES
('cycle_count:execute', 'Execute inventory cycle count tasks'),
('cycle_count:manage', 'Manage and review inventory cycle counts')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to admin role (permission_level_id 10 is Admin)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 10, permission_id
FROM permission
WHERE permission_key IN ('cycle_count:execute', 'cycle_count:manage')
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;

INSERT INTO settings (setting_key, setting_value, description) VALUES
('CYCLE_COUNT_ENABLED', 'false', 'Enable the automated cycle counting system'),
('CYCLE_COUNT_SCHEDULE', '0 2 * * *', 'Cron schedule for batch generation'),
('CYCLE_COUNT_BATCH_SIZE', '50', 'Default number of items per batch'),
('CYCLE_COUNT_UNCOUNTED_WEIGHT', '1', 'Priority points per day since last count'),
('CYCLE_COUNT_VELOCITY_WEIGHT', '5', 'Priority points per sale in last 30 days'),
('CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT', '1000', 'Priority points for items with negative stock')
ON CONFLICT (setting_key) DO NOTHING;
