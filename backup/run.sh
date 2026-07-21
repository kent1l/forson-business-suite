#!/bin/sh
# run.sh — DB-driven backup scheduler
# Reads BACKUP_SCHEDULE_CRON from the settings table and dynamically
# manages a supercronic process. Re-checks every 60s so schedule changes
# made via the Settings UI take effect within the next minute.
set -e

export TZ="${TZ:-Asia/Manila}"

# --- Helper ---
db_setting() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAq \
        -c "SELECT COALESCE(setting_value, '$2') FROM settings WHERE setting_key = '$1';" \
        2>/dev/null || echo "$2"
}


# --- Wait for DB ---
echo "[run.sh] Waiting for database at $DB_HOST..."
until pg_isready -h "$DB_HOST" -U "$DB_USER" -q; do
    sleep 3
done
echo "[run.sh] Database is ready."

# --- Prepare backup dir ---
mkdir -p "$BACKUP_PATH"
chmod 777 "$BACKUP_PATH"

# --- Copy scripts from bind-mounted /scripts (read-only) to /tmp ---
cp /scripts/backup.sh /tmp/backup.sh
chmod +x /tmp/backup.sh

# --- Trap for clean shutdown ---
SUPERCRONIC_PID=""
cleanup() {
    echo "[run.sh] Shutting down..."
    if [ -n "$SUPERCRONIC_PID" ]; then
        kill "$SUPERCRONIC_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup INT TERM

# --- Dynamic cron loop ---
CURRENT_CRON=""

echo "[run.sh] Starting backup scheduler..."

while true; do
    NEW_CRON=$(db_setting BACKUP_SCHEDULE_CRON "0 2 * * *")

    if [ "$NEW_CRON" != "$CURRENT_CRON" ]; then
        echo "[run.sh] Cron expression: '$NEW_CRON'"

        # Kill existing supercronic if running
        if [ -n "$SUPERCRONIC_PID" ] && kill -0 "$SUPERCRONIC_PID" 2>/dev/null; then
            echo "[run.sh] Restarting supercronic with new schedule..."
            kill "$SUPERCRONIC_PID" 2>/dev/null || true
            wait "$SUPERCRONIC_PID" 2>/dev/null || true
        fi

        # Write crontab and start supercronic in background
        echo "$NEW_CRON /tmp/backup.sh" > /tmp/backup.crontab
        supercronic /tmp/backup.crontab &
        SUPERCRONIC_PID=$!
        CURRENT_CRON="$NEW_CRON"
        echo "[run.sh] Supercronic started (PID: $SUPERCRONIC_PID)"
    fi

    # Re-check every 60 seconds (picks up Settings UI changes quickly)
    sleep 60 &
    wait $!
done
