-- Engine-generated earnings, including negative earnings for unpaid half-days.
-- Keep them out of recurring-component pickers to prevent duplicate pay.
BEGIN;

INSERT INTO pay_component
    (component_code, component_name, component_type, is_taxable, is_statutory, is_active, is_assignable, sort_order)
VALUES
    ('REST_DAY', 'Rest Day Pay', 'EARNING', true, false, true, false, 5),
    ('HOLIDAY_UNWORKED', 'Unworked Regular Holiday Pay', 'EARNING', true, false, true, false, 5),
    ('HALF_DAY_UNPAID', 'Unpaid Half Days', 'EARNING', true, false, true, false, 2)
ON CONFLICT (component_code) DO NOTHING;

COMMIT;
