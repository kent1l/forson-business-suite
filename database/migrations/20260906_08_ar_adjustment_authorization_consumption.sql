-- Migration: 20260906_08_ar_adjustment_authorization_consumption.sql
-- Description: Make "this authorization has been spent" a first-class fact.
--
-- 20260906_05 gave ar_adjustment_authorization_log a token_jti and a partial
-- unique index over it, which stops the same jti being ISSUED twice. What it did
-- not give was anywhere to record that a token had been USED. Single use is the
-- whole point of the inline manager authorization: a cashier who obtains one
-- approval must not be able to submit it twice and forgive the balance twice.
--
-- Without this column the service had to mark consumption by rewriting the notes
-- text and then test for that string, which makes an audit-trail field
-- load-bearing for a security control -- anyone tidying up a note would silently
-- un-spend a live token.
--
-- consumed_at is written by an UPDATE whose WHERE clause requires it to still be
-- NULL, so two concurrent submissions of the same token race in the database:
-- the second re-evaluates the predicate against the committed row, matches
-- nothing, and is refused.

BEGIN;

ALTER TABLE public.ar_adjustment_authorization_log
    ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

COMMENT ON COLUMN public.ar_adjustment_authorization_log.consumed_at IS
    'When the authorization token was spent on a concession. NULL means still unused. Set by an UPDATE that requires it to be NULL, which is what makes the token single-use.';

-- Finds the one unspent row for a jti without scanning the log.
CREATE INDEX IF NOT EXISTS idx_ar_auth_log_unspent
    ON public.ar_adjustment_authorization_log (token_jti)
    WHERE token_jti IS NOT NULL AND action = 'AUTHORIZED' AND consumed_at IS NULL;

-- Any token issued before this column existed is treated as already spent. There
-- are at most a handful (the feature ships with this migration), they have long
-- since expired against their 3-minute TTL, and marking them closed is the safe
-- direction to be wrong in.
UPDATE public.ar_adjustment_authorization_log
   SET consumed_at = created_at
 WHERE action = 'AUTHORIZED'
   AND token_jti IS NOT NULL
   AND consumed_at IS NULL;

COMMIT;
