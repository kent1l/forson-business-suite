-- A cash drawer is a logical custody location; hardware is optional.
-- Existing and newly created drawers use manual counting until an electronic
-- drawer integration is explicitly configured in a later release.
ALTER TABLE cash_drawer
  ADD COLUMN IF NOT EXISTS hardware_mode varchar(20) NOT NULL DEFAULT 'MANUAL_CASH_BOX';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_drawer_hardware_mode_check'
      AND conrelid = 'cash_drawer'::regclass
  ) THEN
    ALTER TABLE cash_drawer ADD CONSTRAINT cash_drawer_hardware_mode_check
      CHECK (hardware_mode IN ('MANUAL_CASH_BOX', 'ELECTRONIC_DRAWER'));
  END IF;
END;
$$;
