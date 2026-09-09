-- Migration: 20260907_01_analytics_permissions_and_settings.sql
-- Description: RBAC keys and Admin Settings for the Business Analytics module,
--              per .agents/rules/06-feature-permissions-and-admin-settings.md.
--
-- Three keys rather than one, because the page mixes three different kinds of
-- exposure:
--
--   * analytics:view       -- the boards themselves. Sales, margin, inventory
--                             and A/R figures a manager needs to do the job.
--   * analytics:financials -- operating expenses, payroll cost and net profit.
--                             Held separately because these are the numbers
--                             that describe what the business pays its staff and
--                             its landlord, not what it sells.
--   * analytics:export     -- taking the underlying rows off the system as CSV.
--                             Reading a figure on screen and walking out with
--                             the data behind it are different acts.
--
-- reports:view is deliberately NOT reused: it is already granted to five roles,
-- and granting all of them margin and payroll analytics as a side effect of
-- adding a page is not a decision a migration should make.
--
-- Seeded to Admin and Manager. Extending it to other roles is the owner's call
-- in Settings > Permissions. PermissionsSettings.jsx renders whatever
-- GET /permissions returns, grouped by category, so these appear in the admin UI
-- with no frontend change.

BEGIN;

INSERT INTO public.permission (permission_key, description, category) VALUES
    ('analytics:view',
     'View the Business Analytics boards',
     'Administration'),
    ('analytics:financials',
     'View financial analytics: operating expenses, payroll cost and net profit',
     'Administration'),
    ('analytics:export',
     'Export analytics data as CSV',
     'Administration')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
  FROM public.permission_level pl
 CROSS JOIN public.permission p
 WHERE pl.level_name IN ('Admin', 'Manager')
   AND p.permission_key IN ('analytics:view', 'analytics:financials', 'analytics:export')
ON CONFLICT DO NOTHING;

-- PUT /settings issues an UPDATE, never an upsert, so a key that was not
-- inserted here silently no-ops when an admin tries to change it.
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('ANALYTICS_ENABLED', 'true',
     'Master switch for the Business Analytics page. Turning it off hides the page; it does not affect Reporting or the Dashboard.'),
    ('ANALYTICS_DEFAULT_PERIOD', 'last_30_days',
     'The date range a board opens on before the user picks another. One of: today, yesterday, last_7_days, last_30_days, last_90_days, this_month, last_month, this_quarter, year_to_date, last_12_months.'),
    ('ANALYTICS_CACHE_TTL_SECONDS', '60',
     'How long an analytics result stays cached. Short keeps a sale made at the counter visible quickly; long absorbs a board''s render storm. Tiles show how old a cached figure is and offer a refresh.'),
    ('ANALYTICS_LOW_COVERAGE_THRESHOLD', '50',
     'Below this percentage of cost coverage, a profit or margin figure is presented as measured on too little data to lead with. It never changes the number itself, only how plainly the gap is stated.')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
