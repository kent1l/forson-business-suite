-- Migration: 20260816_07_fix_permission_description_wac_scope.sql
-- Description: 20260816_04_seed_transaction_date_permissions.sql's
--              description for transaction:change_date_unrestricted claimed
--              it gates "moving a cost-bearing inventory transaction that
--              forces a WAC recompute" — but transactionDateService.js only
--              ever checks this permission for month/year-boundary crossings;
--              a WAC-affecting change (GRN, credit note) within the same
--              month only requires the base transaction:change_date. Fixing
--              the description to describe what is actually enforced, so an
--              admin reading the permissions screen isn't given a false
--              sense of what the "restricted" key protects.

BEGIN;

UPDATE permission
   SET description = 'Correct a transaction''s date across a month/year boundary (e.g. into an already-closed accounting period)'
 WHERE permission_key = 'transaction:change_date_unrestricted';

COMMIT;
