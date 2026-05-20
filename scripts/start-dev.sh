#!/bin/bash

set -e

log() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

# --- AUTOMATED ENV CONFIGURATION ---
if [ ! -f .env ]; then
    echo "[Initialization] Cloning .env from template..."
    cp .env.example .env
fi

if grep -q "MEILISEARCH_MASTER_KEY=$" .env || grep -q "your_placeholder" .env; then
    echo "[Initialization] Generating secure Meilisearch master key..."
    SECURE_KEY=$(openssl rand -hex 32)
    sed -i "s|^MEILISEARCH_MASTER_KEY=.*|MEILISEARCH_MASTER_KEY=${SECURE_KEY}|g" .env
fi
# -----------------------------------

log "Starting local development stack..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

MAX_RETRIES=15
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  CONTAINER_STATUS=$(docker inspect -f '{{.State.Status}}' forson_backend_dev 2>/dev/null || echo "missing")

  if [ "$CONTAINER_STATUS" = "running" ]; then
    log "Backend container is running."
    break
  fi

  log "Waiting for backend container to start... (Attempt $((RETRY_COUNT+1))/$MAX_RETRIES)"
  sleep 2
  RETRY_COUNT=$((RETRY_COUNT+1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  log "ERROR: Backend container failed to reach running state."
  exit 1
fi

sleep 3

log "Verifying migration checksums for drift..."
if ! docker compose exec backend node scripts/migrate.js verify; then
  log "⚠️ WARNING: Migration drift detected! You have modified files that were already applied locally."
  log "⚠️ Please resolve this or run ./scripts/reset-dev-db.sh for a clean slate."
fi

log "Running database migrations inside backend container..."
docker compose exec backend node scripts/migrate.js up

log "Development environment is ready."
log "If needed, make this script executable: chmod +x scripts/start-dev.sh"
