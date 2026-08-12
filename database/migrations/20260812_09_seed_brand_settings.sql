-- Migration: 20260812_09_seed_brand_settings.sql
-- Description: Seed default brand color settings ("Forson Slate" theme) for
--              the new Brand Identity / Theme feature. Values match the
--              app's existing default blue so a fresh migration does not
--              visually change any current deployment until an admin
--              actively customizes their branding. Reuses the existing
--              settings:edit permission - no new permission key needed.

BEGIN;

INSERT INTO settings (setting_key, setting_value, description)
VALUES
  ('BRAND_PRIMARY_COLOR',      '#2563eb', 'Primary brand color (hex), drives the primary Tailwind color ramp'),
  ('BRAND_ACCENT_COLOR',       '',        'Optional accent brand color (hex); empty = derived from primary'),
  ('BRAND_PRIMARY_COLOR_DARK', '#3b82f6', 'Primary color override for dark mode (auto-derived unless set)'),
  ('BRAND_ACCENT_COLOR_DARK',  '',        'Accent color override for dark mode'),
  ('BRAND_THEME_NAME',         'Forson Slate', 'Name of the active color preset, or "Custom"')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
