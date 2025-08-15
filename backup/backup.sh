#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

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
FILENAME="$BACKUP_PATH/backup-$(date +%Y-%m-%dT%H-%M-%S).sql.gz"

echo "Starting backup of database '$DB_NAME'..."

# Use pg_dump to create a compressed SQL dump of the database.
# The PGPASSWORD environment variable is used by pg_dump for authentication.
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME -F c -Z 9 > "$FILENAME"

echo "Backup successful: $FILENAME"

# --- Retention Policy / Cleanup ---

echo "Applying retention policy: keeping last $BACKUP_RETENTION_DAYS days..."

# Find and delete backup files older than the specified retention period.
# -mtime +N finds files modified more than N days ago.
find $BACKUP_PATH -type f -name "*.sql.gz" -mtime +$BACKUP_RETENTION_DAYS -exec rm -f {} \;

echo "Cleanup complete."
echo "---------------------"

