-- Smart PO entry: named, expiring draft slots (up to five enforced by the API).
BEGIN;

ALTER TABLE public.draft_transaction
    ADD COLUMN IF NOT EXISTS draft_name varchar(100) NOT NULL DEFAULT 'Draft',
    ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days');

ALTER TABLE public.draft_transaction
    DROP CONSTRAINT IF EXISTS draft_transaction_employee_id_transaction_type_key;

ALTER TABLE public.draft_transaction
    DROP CONSTRAINT IF EXISTS uq_draft_per_user_name;

ALTER TABLE public.draft_transaction
    ADD CONSTRAINT uq_draft_per_user_name
    UNIQUE (employee_id, transaction_type, draft_name);

CREATE INDEX IF NOT EXISTS idx_draft_transaction_expiry
    ON public.draft_transaction (employee_id, transaction_type, expires_at);

COMMIT;
