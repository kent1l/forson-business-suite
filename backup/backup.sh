#!/bin/bash

# Don't exit the whole container loop on a single command failure.
# We'll handle errors explicitly so the wrapper loop can continue.
set -o pipefail

# --- Environment Variables ---
# These are expected to be passed in from the docker-compose.yml file.
# DB_HOST: The hostname of the database service (e.g., 'db').
# DB_NAME: The name of the database to back up.
# DB_USER: The username for the database.
# DB_PASSWORD: The password for the database user.
# BACKUP_PATH: The directory inside the container where backups are stored (e.g., '/backups').
# BACKUP_RETENTION_DAYS: How many days to keep backup files.

# --- Backup Execution ---

# Format the filename with the current date and time
# Ensure BACKUP_PATH has a default
BACKUP_PATH=${BACKUP_PATH:-/backups}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}

# Ensure backup directory exists and is writable
mkdir -p "$BACKUP_PATH"

FILENAME="$BACKUP_PATH/backup-$(date +%Y-%m-%dT%H-%M-%S).sql.gz"

echo "Starting backup of database '${DB_NAME}'..."

# Use pg_dump to create a compressed SQL dump of the database.
# Use -f to write directly to the file (avoids partial writes on errors when redirecting).
PGPASSWORD=${DB_PASSWORD} pg_dump -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -F c -Z 9 -f "${FILENAME}"
rc=$?
if [ $rc -ne 0 ]; then
	echo "Backup failed (pg_dump exit code $rc). Removing incomplete file if present: ${FILENAME}"
	rm -f "${FILENAME}"
	# Return non-zero so the caller can log it; but do not exit the shell so the loop wrapper can continue.
	return $rc 2>/dev/null || exit $rc
fi

echo "Backup successful: ${FILENAME}"

# --- Retention Policy / Cleanup ---

echo "Applying retention policy: keeping last ${BACKUP_RETENTION_DAYS} days..."

# Find and delete backup files older than the specified retention period.
find "${BACKUP_PATH}" -type f -name "*.sql.gz" -mtime +${BACKUP_RETENTION_DAYS} -print -exec rm -f {} \;

echo "Cleanup complete."
echo "---------------------"

