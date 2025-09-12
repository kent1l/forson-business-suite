-- Add parts:merge permission
-- Migration: 20250912_add_parts_merge_permission.sql

-- Insert the new permission
INSERT INTO permission (permission_key, description) 
VALUES ('parts:merge', 'Merge duplicate parts into a single canonical part')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to admin role (permission_level_id 10 is Admin)
INSERT INTO role_permission (permission_level_id, permission_id)
SELECT 10, permission_id 
FROM permission 
WHERE permission_key = 'parts:merge'
ON CONFLICT (permission_level_id, permission_id) DO NOTHING;
