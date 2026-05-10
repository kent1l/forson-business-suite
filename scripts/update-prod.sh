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

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 4: Executing database migrations..."
./scripts/migrate-prod.sh

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Step 5: Performing safe cleanup..."
sudo docker image prune -f

echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] Production update completed successfully."
