#!/bin/bash

# Ensure the script aborts immediately if any command fails
set -e

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Starting production update process..."

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 1: Pulling latest code..."
git pull

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 2: Building and pulling latest Docker images..."
sudo docker compose -f docker-compose.prod.yml build
sudo docker compose -f docker-compose.prod.yml pull

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 3: Starting/Updating containers..."
sudo docker compose -f docker-compose.prod.yml up -d

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 4: Pre-flight Disk Check (5GB minimum)..."
REQUIRED_SPACE_KB=5242880
FREE_SPACE_KB=$(df -k / | awk 'NR==2 {print $4}')

if [ "$FREE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]; then
    echo "ERROR: Insufficient disk space. Requires at least 5GB free."
    exit 1
fi
echo "Disk space check passed."

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 5: Executing database migrations..."
# Mount the local database directory and override MIGRATIONS_DIR via env variable
# to execute migrations safely without modifying the container's file system state.
sudo docker compose -f docker-compose.prod.yml run --rm \
    -v "$(pwd)/database:/database:ro" \
    -e MIGRATIONS_DIR=/database/migrations \
    backend node scripts/migrate.js up

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 6: Performing safe cleanup..."
sudo docker image prune -f

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Production update completed successfully."
