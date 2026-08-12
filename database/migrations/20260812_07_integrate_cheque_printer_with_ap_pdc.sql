-- Migration: 20260813_01_integrate_cheque_printer_with_ap_pdc.sql
-- Description: Wire the existing cheque-printing module (cheque_templates,
--              printer_profiles, generate-pdf) to the outbound AP/PDC Treasury
--              Desk so issuing a cheque can auto-populate and print it, and add
--              a PRINTED audit action so print/reprint of AP-tracked cheques is
--              logged. Also aligns cheques:* permissions with ap-pdc:* grants so
--              Manager users who can issue outbound cheques can also print them.

BEGIN;

-- Each bank account can have a default print layout so issuing a cheque from
-- that account doesn't require re-selecting a template every time.
ALTER TABLE bank_account
    ADD COLUMN IF NOT EXISTS default_cheque_template_id integer REFERENCES cheque_templates(id) ON DELETE SET NULL;

ALTER TABLE cheque_clearance_log DROP CONSTRAINT IF EXISTS cheque_clearance_log_action_check;
ALTER TABLE cheque_clearance_log ADD CONSTRAINT cheque_clearance_log_action_check
    CHECK (action IN ('RECEIVED', 'DEPOSITED', 'BOUNCED', 'REDEPOSITED', 'CLEARED', 'VOID', 'REPLACED', 'PRINTED'));

-- cheques:view/create were previously Admin-only; Manager already has
-- ap-pdc:manage (can issue outbound cheques) but not the permissions needed to
-- actually print one. Align the two so the desk's Print action isn't silently
-- broken for Managers.
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 7, p.permission_id
FROM permission p
WHERE p.permission_key IN ('cheques:view', 'cheques:create')
ON CONFLICT DO NOTHING;

COMMIT;
