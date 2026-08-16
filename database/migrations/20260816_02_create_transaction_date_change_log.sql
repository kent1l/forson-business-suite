-- Migration: 20260816_02_create_transaction_date_change_log.sql
-- Description: Audit log for the transaction-date-override feature. Modelled
--              directly on due_date_log (20250917_create_due_date_log_table.sql)
--              and supplier_bill_due_date_log (20260813_02), extended with a
--              cascade_summary / wac_impact payload since one date change here
--              can move many dependent rows across several tables at once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.transaction_date_change_log (
    log_id              bigserial PRIMARY KEY,
    transaction_kind    varchar(40) NOT NULL,   -- registry key, e.g. 'invoice', 'goods_receipt'
    transaction_id      integer NOT NULL,
    transaction_ref     varchar(100),           -- human document number, e.g. invoice_number / grn_number
    old_date            timestamptz NOT NULL,
    new_date            timestamptz NOT NULL,
    days_shifted        integer,                -- positive = moved later, negative = moved earlier
    reason              text NOT NULL,
    cascade_summary     jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{table, column, row_count, old_date, new_date}, ...]
    wac_impact          jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{part_id, old_wac_cost, new_wac_cost}, ...]
    changed_by          integer NOT NULL REFERENCES public.employee(employee_id) ON DELETE RESTRICT,
    changed_on          timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address          inet,
    user_agent          text
);

CREATE INDEX IF NOT EXISTS idx_txn_date_log_kind_id ON public.transaction_date_change_log(transaction_kind, transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_date_log_changed_by ON public.transaction_date_change_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_txn_date_log_changed_on ON public.transaction_date_change_log(changed_on);

COMMENT ON TABLE public.transaction_date_change_log IS 'Audit log for the generic transaction-date-override feature (transactionDateService.js): records every date correction and the full cascade it produced.';
COMMENT ON COLUMN public.transaction_date_change_log.cascade_summary IS 'Every dependent row that moved as part of this change: [{table, column, row_count, old_date, new_date}, ...]';
COMMENT ON COLUMN public.transaction_date_change_log.wac_impact IS 'Parts whose weighted-average cost was recomputed as a result of this change: [{part_id, old_wac_cost, new_wac_cost}, ...]';

COMMIT;
