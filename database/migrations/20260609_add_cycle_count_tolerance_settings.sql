INSERT INTO settings (setting_key, setting_value, description) VALUES
('CYCLE_COUNT_MAX_VARIANCE_QTY', '2', 'Auto-approve cycle counts if variance quantity is <= this value'),
('CYCLE_COUNT_MAX_FINANCIAL_IMPACT', '5.00', 'Auto-approve cycle counts if variance financial impact is <= this value')
ON CONFLICT (setting_key) DO NOTHING;
