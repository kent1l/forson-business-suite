#!/bin/bash

set -e

log() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

log "⚠️ WARNING: This will DESTROY all local development data in forson_business_suite."
log "Press Ctrl+C within 5 seconds to cancel..."
sleep 5

log "Dropping local development database..."
docker compose exec db psql -U postgres -c "DROP DATABASE IF EXISTS forson_business_suite WITH (FORCE);"

log "Recreating local development database..."
docker compose exec db psql -U postgres -c "CREATE DATABASE forson_business_suite;"

log "Applying baseline schema..."
docker compose exec db psql -U postgres -d forson_business_suite -f /docker-entrypoint-initdb.d/01_initial_schema.sql

log "Applying migrations to latest commit..."
docker compose exec backend node scripts/migrate.js up

log "Database reset complete."
log "If needed, make this script executable: chmod +x scripts/reset-dev-db.sh"
