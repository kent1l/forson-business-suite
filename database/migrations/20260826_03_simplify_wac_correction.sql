-- Migration: 20260826_03_simplify_wac_correction.sql
-- Description: Collapse the cost correction workflow to a single manager action.
--
--   Backfilling receipts from the goods receipt page (20260826_02) now covers every
--   case where a document exists: it is faster, safer (dedupe on the supplier's
--   invoice number), and staff already know the screen. That left exactly one thing
--   for the standalone correction module to do -- a part whose cycle count confirms
--   real stock exists but for which no receipt can be found at all. Estimating that
--   remainder is a manager's judgment call, not research an encoder does and a
--   manager checks, so the propose/review split, the batch queue, and the multi-entry
--   evidence table it existed to support are no longer earning their complexity.
--
--   wac_correction_batch, wac_correction_line, and wac_correction_entry are dropped.
--   wac_correction_audit_log is kept as the record of these corrections, with the
--   columns that only made sense for a multi-step, multi-entry workflow removed.

BEGIN;

ALTER TABLE public.wac_correction_audit_log
    DROP CONSTRAINT IF EXISTS wac_correction_audit_log_line_id_fkey;

DROP TABLE IF EXISTS public.wac_correction_entry;
DROP TABLE IF EXISTS public.wac_correction_line;
DROP TABLE IF EXISTS public.wac_correction_batch;

ALTER TABLE public.wac_correction_audit_log
    DROP COLUMN IF EXISTS line_id,
    DROP COLUMN IF EXISTS entry_count;

COMMENT ON TABLE public.wac_correction_audit_log IS
    'Record of manager-entered cost estimates for stock a cycle count confirmed but no receipt could be found for. See wacCorrectionService.js.';

-- Collapse propose/approve into one permission. wac_correction:propose is retired --
-- there is no research step left to separate from the posting action.
DELETE FROM role_permission
 WHERE permission_id = (SELECT permission_id FROM permission WHERE permission_key = 'wac_correction:propose');
DELETE FROM permission WHERE permission_key = 'wac_correction:propose';

UPDATE permission
   SET permission_key = 'wac_correction:manage',
       description = 'Estimate and post cost for cycle-counted stock with no receipt on file'
 WHERE permission_key = 'wac_correction:approve';

COMMIT;
