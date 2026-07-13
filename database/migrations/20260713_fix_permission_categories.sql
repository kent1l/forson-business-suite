-- Fix permission categories for consistency
-- Migration: 20260713_fix_permission_categories.sql

-- Move pos:use from General to Sales & A/R (POS creates invoices/revenue)
UPDATE permission SET category = 'Sales & A/R'
WHERE permission_key = 'pos:use'
  AND (category IS NULL OR category = '' OR category = 'General');

-- Move parts:merge to Data Management (parts data operation)
UPDATE permission SET category = 'Data Management'
WHERE permission_key = 'parts:merge'
  AND (category IS NULL OR category = '');

-- Move cycle count permissions to Inventory & Purchasing
UPDATE permission SET category = 'Inventory & Purchasing'
WHERE permission_key IN ('cycle_count:execute', 'cycle_count:manage')
  AND (category IS NULL OR category = '');

-- Split Documents out of Data Management into its own category
UPDATE permission SET category = 'Documents'
WHERE permission_key IN ('documents:view', 'documents:download', 'documents:share')
  AND category = 'Data Management';
