-- Preserve the physical notebook/page or receipt reference independently of the ledger description.
ALTER TABLE cash_drawer_movement ADD COLUMN IF NOT EXISTS physical_reference varchar(120);
