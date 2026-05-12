#!/usr/bin/env bash
set -e
set -o pipefail

echo "DEPRECATED: This script is deprecated. Please use the Node.js runner via 'docker compose exec api node scripts/migrate.js up' instead."
exit 1

# 1. Pre-flight Disk Check (5GB minimum)
REQUIRED_SPACE_KB=5242880
FREE_SPACE_KB=$(df -k / | awk 'NR==2 {print $4}')

if [ "$FREE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]; then
    echo "ERROR: Insufficient disk space. Requires at least 5GB free."
    exit 1
fi

LOG_FILE="migration_$(date +%Y%m%d_%H%M%S).log"
echo "Disk space check passed. Starting migrations..."
echo "Audit log will be saved to: $LOG_FILE"

TMP_SQL=$(mktemp)

# 2. Maintain alphabetical order and build single payload
for f in $(ls database/migrations/*.sql | sort); do
    # \echo is a psql command that prints to stdout
    echo "\echo '========================================'" >> "$TMP_SQL"
    echo "\echo 'Executing file: $f'" >> "$TMP_SQL"
    echo "\echo '========================================'" >> "$TMP_SQL"
    cat "$f" >> "$TMP_SQL"
    echo "" >> "$TMP_SQL"
done

# 3. Single Connection Execution with ON_ERROR_STOP
# Capture stderr/stdout and tee to log file
cat "$TMP_SQL" | sudo docker exec -i forson_db psql -v ON_ERROR_STOP=1 -U postgres -d forson_business_suite 2>&1 | tee "$LOG_FILE"

# Clean up
rm "$TMP_SQL"

echo "Database migrations completed successfully."
