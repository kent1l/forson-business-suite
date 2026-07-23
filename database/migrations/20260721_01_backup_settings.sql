-- Migration: 20260721_01_backup_settings.sql
-- Adds DB-driven backup configuration keys to the settings table.
-- These keys are read at runtime by backup.sh and managed via the Settings UI.

INSERT INTO public.settings (setting_key, setting_value, description) VALUES
    ('BACKUP_RETENTION_DAYS',        '7',                      'Local backup retention in days'),
    ('BACKUP_SCHEDULE_CRON',         '0 2 * * *',              'Backup schedule as a cron expression (default: daily at 2am)'),
    ('BACKUP_GDRIVE_ENABLED',        'false',                  'Enable Google Drive remote backup via rclone'),
    ('BACKUP_GDRIVE_REMOTE',         'gdrive:forson-backups',  'rclone remote destination path for Google Drive backups'),
    ('BACKUP_TAILSCALE_ENABLED',     'false',                  'Enable Tailscale rsync remote backup'),
    ('BACKUP_TAILSCALE_HOST',        '',                       'Tailscale peer hostname or IP address'),
    ('BACKUP_TAILSCALE_PATH',        '~/forson-backups',       'Destination path on Tailscale peer'),
    ('BACKUP_REMOTE_RETENTION_DAYS', '30',                     'Remote backup retention in days')
ON CONFLICT (setting_key) DO NOTHING;
