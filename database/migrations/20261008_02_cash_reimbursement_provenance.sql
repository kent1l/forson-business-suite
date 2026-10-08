ALTER TABLE cash_advance_event
  ADD COLUMN payer_employee_id integer REFERENCES employee(employee_id) ON DELETE RESTRICT,
  ADD COLUMN payer_evidence varchar(500);
