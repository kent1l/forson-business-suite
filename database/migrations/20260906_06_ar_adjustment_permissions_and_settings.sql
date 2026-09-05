-- Migration: 20260906_06_ar_adjustment_permissions_and_settings.sql
-- Description: RBAC keys and Admin Settings for post-invoice A/R concessions,
--              per .agents/rules/06-feature-permissions-and-admin-settings.md.
--
-- The authorization model, decided with the owner, has no amount thresholds:
--
--   * A holder of ar:discount_grant grants a concession directly, with no
--     approval step and no cap. The owner and managers meet no friction at the
--     counter, which is the whole point -- a control that slows down every
--     settlement gets worked around instead of followed.
--   * Anyone without it can still key one in, but the submission has to be
--     authorized by someone who holds it, entering their own credentials. Both
--     employees end up named on the document, and failed attempts are logged.
--
-- Seeded to Admin only. Assigning it to Manager or Cashier is a decision for the
-- owner in Settings > Permissions, not something a migration should presume.

BEGIN;

INSERT INTO public.permission (permission_key, description, category) VALUES
    ('ar:discount_grant',
     'Grant a post-invoice settlement discount or balance write-down without further approval, and authorize one for another user',
     'Sales & A/R'),
    ('ar:adjustment_reverse',
     'Reverse a posted A/R adjustment',
     'Sales & A/R')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO public.role_permission (permission_level_id, permission_id)
SELECT pl.permission_level_id, p.permission_id
  FROM public.permission_level pl
 CROSS JOIN public.permission p
 WHERE pl.level_name = 'Admin'
   AND p.permission_key IN ('ar:discount_grant', 'ar:adjustment_reverse')
ON CONFLICT DO NOTHING;

-- PUT /settings issues an UPDATE, not an upsert, so a key that was never
-- inserted here silently no-ops when an admin tries to change it.
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('ENABLE_AR_ADJUSTMENTS', 'true',
     'Master switch for post-invoice A/R settlement discounts and balance write-downs.'),
    ('AR_ADJUSTMENT_CONFIRM_PERCENT', '10',
     'A concession worth more than this percentage of the invoice balance asks the user to confirm. A speed bump against a mis-keyed amount, not an approval gate.'),
    ('AR_ADJUSTMENT_AUTH_TTL_SECONDS', '180',
     'How long an inline manager authorization stays valid before it must be entered again.')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
