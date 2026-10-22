-- Collection groups own customer balances and must participate in the same
-- locking and retired-customer checks as individual customer payments.
DROP TRIGGER IF EXISTS master_merge_guard_customer_id ON public.customer_payment_collection_group;
CREATE TRIGGER master_merge_guard_customer_id
    BEFORE INSERT OR UPDATE OR DELETE ON public.customer_payment_collection_group
    FOR EACH ROW EXECUTE FUNCTION public.guard_master_data_reference('customer', 'customer_id');
