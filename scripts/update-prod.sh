#!/bin/bash

# Ensure the script aborts immediately if any command fails
set -e

# Helper function for standardized logging
log() {
    echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1"
}

log "Starting smart production update process..."

# ==========================================
# STEP 0: PRE-FLIGHT CHECKS
# ==========================================
log "Step 0: Performing system and dependency checks..."

if ! command -v docker &> /dev/null; then
    log "ERROR: Docker is not installed or not available in PATH."
    exit 1
fi

# Disk Space Check (5GB minimum)
REQUIRED_SPACE_KB=5242880
FREE_SPACE_KB=$(df -k / | awk 'NR==2 {print $4}')
if [ -z "$FREE_SPACE_KB" ] || [ "$FREE_SPACE_KB" -lt "$REQUIRED_SPACE_KB" ]; then
    log "ERROR: Insufficient disk space. Requires at least 5GB free. Currently available: $(($FREE_SPACE_KB / 1024))MB."
    exit 1
fi


# ==========================================
# STEP 1: SMART GIT UPDATE
# ==========================================
log "Step 1: Synchronizing repository state..."

# Safely fetch all latest branches and tags from the remote without altering the working directory yet
git fetch --all --tags --prune > /dev/null 2>&1

# Determine Git state to decide if a pull is needed
if git symbolic-ref -q HEAD > /dev/null; then
    # We are on a branch (e.g., 'master' for Staging)
    CURRENT_BRANCH=$(git branch --show-current)
    log "Detected active branch: '$CURRENT_BRANCH'. Executing git pull..."
    git pull origin "$CURRENT_BRANCH"
else
    # We are in a detached HEAD state (e.g., checked out to a specific 'v1.4.4' tag for Production)
    EXACT_TAG=$(git describe --tags --exact-match 2>/dev/null || true)
    if [ -n "$EXACT_TAG" ]; then
        log "Detected release tag: '$EXACT_TAG'. Code state is static. Skipping git pull."
    else
        log "Detected detached HEAD at commit $(git rev-parse --short HEAD). Skipping git pull."
    fi
fi


# ==========================================
# STEP 2 & 3: DOCKER BUILD & DEPLOY
# ==========================================
log "Step 2: Building and pulling latest Docker images..."
sudo docker compose -f docker-compose.prod.yml build
sudo docker compose -f docker-compose.prod.yml pull

log "Step 3: Starting and updating containers..."
sudo docker compose -f docker-compose.prod.yml up -d --remove-orphans


# ==========================================
# STEP 4: SERVICE READINESS CHECK
# ==========================================
log "Step 4: Waiting for backend service readiness..."

# Wait loop to ensure the backend container is fully up before forcing migrations into it
MAX_RETRIES=15
RETRY_COUNT=0
sleep 2

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Check the actual Docker state of the backend container
    CONTAINER_STATUS=$(sudo docker compose -f docker-compose.prod.yml ps -q backend | xargs -r sudo docker inspect -f '{{.State.Status}}' 2>/dev/null || echo "missing")
    
    if [ "$CONTAINER_STATUS" == "running" ]; then
        log "Backend container is active and running."
        break
    fi
    
    log "Waiting for backend container to start... (Attempt $((RETRY_COUNT+1))/$MAX_RETRIES)"
    sleep 3
    RETRY_COUNT=$((RETRY_COUNT+1))
done

if [ "$RETRY_COUNT" -eq "$MAX_RETRIES" ]; then
    log "ERROR: Backend container failed to enter 'running' state within the timeout. Migrations aborted."
    exit 1
fi

# Give the PostgreSQL database a brief moment to accept socket connections after containers spin up
sleep 3


# ==========================================
# STEP 5 & 6: MIGRATIONS & CLEANUP
# ==========================================
log "Step 5: Executing database migrations..."
sudo docker compose -f docker-compose.prod.yml exec -T backend node scripts/migrate.js up

log "Step 6: Performing safe image cleanup..."
sudo docker image prune -f > /dev/null 2>&1

log "Production update completed successfully!"