-- Migration: 20260723_01_add_timezone_setting.sql
-- Adds Application Timezone configuration key to the settings table.

INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('APP_TIMEZONE', 'Asia/Manila', 'Application timezone for reports and backups')
ON CONFLICT (setting_key) DO NOTHING;
