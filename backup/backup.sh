#!/bin/sh
# backup.sh — PostgreSQL backup with optional remote sync
# All configuration is read from the 'settings' DB table at runtime.
# Secrets (rclone.conf, id_rsa) are expected at /scripts/ (bind-mounted from ./backup/).
set -e

# --- Helper: read a value from the settings table ---
db_setting() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAq \
        -c "SELECT COALESCE(setting_value, '$2') FROM settings WHERE setting_key = '$1';" \
        2>/dev/null || echo "$2"
}

# --- Read local backup config ---
RETENTION=$(db_setting BACKUP_RETENTION_DAYS 7)

# --- Create timestamped backup file ---
mkdir -p "$BACKUP_PATH"
FILENAME="$BACKUP_PATH/backup-$(date +%Y-%m-%dT%H-%M-%S).sql.gz"

echo "[backup.sh] Starting backup → $FILENAME"

# Use plain SQL + gzip (compatible with both psql restore and pg_restore).
# --clean --if-exists: DROP objects before recreating (safe for non-empty DB restore).
# --no-owner --no-acl: portable dump (no role dependencies).
PGPASSWORD="$DB_PASSWORD" pg_dump \
    -h "$DB_HOST" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --clean --if-exists --no-owner --no-acl \
    | gzip > "$FILENAME"

# Ensure the backend container (appuser) can read the file
chmod 644 "$FILENAME"

echo "[backup.sh] Backup complete: $FILENAME"

# --- Retention: delete local backups older than RETENTION days ---
find "$BACKUP_PATH" -type f -name "*.sql.gz" -mtime +"$RETENTION" -exec rm -f {} \;
echo "[backup.sh] Local retention applied ($RETENTION days)."

# ── Google Drive (rclone) ────────────────────────────────────────────────────
GDRIVE_ENABLED=$(db_setting BACKUP_GDRIVE_ENABLED false)
RCLONE_CONF="/scripts/rclone.conf"

if [ "$GDRIVE_ENABLED" = "true" ]; then
    if [ ! -f "$RCLONE_CONF" ]; then
        echo "[backup.sh] WARNING: BACKUP_GDRIVE_ENABLED=true but $RCLONE_CONF not found. Skipping GDrive sync."
    else
        GDRIVE_REMOTE=$(db_setting BACKUP_GDRIVE_REMOTE "gdrive:forson-backups")
        REMOTE_DAYS=$(db_setting BACKUP_REMOTE_RETENTION_DAYS 30)
        echo "[backup.sh] Syncing to GDrive: $GDRIVE_REMOTE ..."
        rclone copy "$FILENAME" "$GDRIVE_REMOTE" \
            --config "$RCLONE_CONF" \
            --log-level INFO
        # Prune remote files older than REMOTE_DAYS days
        rclone delete "$GDRIVE_REMOTE" \
            --min-age "${REMOTE_DAYS}d" \
            --config "$RCLONE_CONF" 2>/dev/null || true
        echo "[backup.sh] GDrive sync complete."
    fi
fi

# ── Tailscale rsync ──────────────────────────────────────────────────────────
TAILSCALE_ENABLED=$(db_setting BACKUP_TAILSCALE_ENABLED false)
SSH_KEY="/scripts/id_rsa"

if [ "$TAILSCALE_ENABLED" = "true" ]; then
    if [ ! -f "$SSH_KEY" ]; then
        echo "[backup.sh] WARNING: BACKUP_TAILSCALE_ENABLED=true but $SSH_KEY not found. Skipping Tailscale sync."
    else
        TS_HOST=$(db_setting BACKUP_TAILSCALE_HOST "")
        TS_PATH=$(db_setting BACKUP_TAILSCALE_PATH "~/forson-backups")
        REMOTE_DAYS=$(db_setting BACKUP_REMOTE_RETENTION_DAYS 30)

        if [ -z "$TS_HOST" ]; then
            echo "[backup.sh] WARNING: BACKUP_TAILSCALE_HOST is empty. Skipping Tailscale sync."
        else
            echo "[backup.sh] rsyncing to Tailscale peer: $TS_HOST ..."
            chmod 600 "$SSH_KEY"
            rsync -avz \
                -e "ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i $SSH_KEY" \
                "$FILENAME" \
                "${TS_HOST}:${TS_PATH}/"
            # Prune old files on remote
            ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i "$SSH_KEY" "$TS_HOST" \
                "find ${TS_PATH} -name '*.sql.gz' -mtime +${REMOTE_DAYS} -delete 2>/dev/null; true"
            echo "[backup.sh] Tailscale rsync complete."
        fi
    fi
fi

echo "[backup.sh] Done. ---------------------"
