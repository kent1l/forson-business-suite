#!/bin/bash

# --- Environment Configuration & Token Management ---
# Automatically copy template if .env does not exist
if [ ! -f .env ]; then
    echo "[Initialization] Creating .env file from template..."
    cp .env.example .env
fi

# Ensure MEILISEARCH_MASTER_KEY is present in the .env file
if ! grep -q "MEILISEARCH_MASTER_KEY" .env; then
    echo "" >> .env
    echo "MEILISEARCH_MASTER_KEY=" >> .env
fi

# Detect if the key is missing, blank, set to placeholder, or contains malformed strings
if grep -q "^MEILISEARCH_MASTER_KEY=\s*$" .env || \
   grep -q "^MEILISEARCH_MASTER_KEY=your_placeholder" .env || \
   grep -q "^MEILISEARCH_MASTER_KEY=another_strong_and_secret_key" .env || \
   grep -q "^MEILISEARCH_MASTER_KEY=placeholder" .env || \
   grep -q "eFg5mY4X54qmZiX30" .env; then
    
    echo "[Initialization] Injecting secure, high-entropy keys into your .env file..."
    
    # Generate a cryptographically secure 64-character token
    SECURE_MEILI_KEY=$(openssl rand -hex 32)
    
    # Clean up the malformed text and format it perfectly as KEY=VALUE
    sed -i "s|^MEILISEARCH_MASTER_KEY=.*|MEILISEARCH_MASTER_KEY=${SECURE_MEILI_KEY}|g" .env
    
    # Clean out any standalone floating instances of the malformed text to prevent Docker Compose warnings
    sed -i "/eFg5mY4X54qmZiX30/d" .env
fi

set -e

log() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

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
