-- Migration: 20260909_01_analytics_phase5_boards_and_saved_views.sql
-- Description: Tables and settings for Phase 5 of Business Analytics:
--              1. analytics_board: User-customizable and system boards
--              2. analytics_saved_view: Saved board views (filters, presets, compare)
--              3. Alert and digest scheduler settings

BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics_board (
    board_id VARCHAR(100) PRIMARY KEY,
    owner_employee_id INTEGER REFERENCES public.employee(employee_id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    period VARCHAR(20) NOT NULL DEFAULT 'range' CHECK (period IN ('range', 'none')),
    default_preset VARCHAR(50) NOT NULL DEFAULT 'last_30_days',
    spec JSONB NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_board_owner ON public.analytics_board (owner_employee_id);

CREATE TABLE IF NOT EXISTS public.analytics_saved_view (
    view_id SERIAL PRIMARY KEY,
    board_id VARCHAR(100) NOT NULL,
    owner_employee_id INTEGER NOT NULL REFERENCES public.employee(employee_id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    state JSONB NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_analytics_saved_view_owner_name UNIQUE (owner_employee_id, board_id, name)
);

CREATE INDEX IF NOT EXISTS idx_analytics_saved_view_owner_board ON public.analytics_saved_view (owner_employee_id, board_id);

INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('ANALYTICS_ALERTS_ENABLED', 'true',
     'Daily scan that evaluates insight rules and emits in-app notifications for warning and critical analytics insights.'),
    ('ANALYTICS_ALERT_SCHEDULE', '30 7 * * *',
     'Cron schedule for the daily analytics insights alert scan (Manila time).'),
    ('ANALYTICS_DIGEST_SCHEDULE', '0 8 * * 1',
     'Cron schedule for the weekly analytics digest notification (Manila time, default Mondays at 08:00).')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
