-- Business Analytics — insights panel settings.
--
-- PRD §14 deferred the insights panel until after Phase 2 and required that its
-- thresholds live in the registry rather than scattered through rule logic, so
-- that they can become admin-tunable without an engineer. The rule definitions
-- carry the thresholds; this migration adds the two settings that are not
-- thresholds at all but facts about this business that no rule can infer.
--
-- ANALYTICS_WALKIN_CUSTOMER_ID is deliberately seeded EMPTY. The walk-in record
-- is a customer row like any other and carries roughly 83% of revenue, so there
-- is no safe way to detect it: guessing wrong would make the customer
-- concentration insight report a confident falsehood about who the business
-- depends on. Until an admin names it, that one rule stays dark and the panel
-- simply does not mention concentration.

BEGIN;

-- PUT /settings issues an UPDATE, never an upsert, so a key that was not
-- inserted here silently no-ops when an admin tries to change it.
INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('ANALYTICS_INSIGHTS_ENABLED', 'true',
     'Shows the insights panel above each analytics board. Insights are generated from fixed rules in the code, never by an AI, and every one of them names the figures it was worked out from.'),
    ('ANALYTICS_WALKIN_CUSTOMER_ID', '',
     'The customer record used for walk-in counter sales. Setting it lets Analytics separate counter trade from named accounts, which is what makes the customer concentration insight meaningful. Leave blank if you do not use one; that insight will simply not appear.')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
