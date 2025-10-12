#!/bin/bash
# rebuild_database.sh
# Drops and recreates the database, applies schema, and runs all migrations
# WARNING: This will DELETE ALL DATA in the database!

set -euo pipefail

# Configuration
CONTAINER_NAME="${1:-forson_db}"
DATABASE_NAME="${2:-forson_business_suite}"
DB_SUPERUSER="${3:-postgres}"
SCHEMA_SCRIPT="${4:-database/initial_schema.sql}"
MIGRATIONS_PATH="${5:-database/migrations}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_step() {
    echo -e "${CYAN}===> $1${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ ERROR: $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ WARNING: $1${NC}"
}

run_docker() {
    if ! docker "$@"; then
        log_error "Docker command failed: docker $*"
        exit 1
    fi
}

# Validate inputs
if [ ! -f "$SCHEMA_SCRIPT" ]; then
    log_error "Schema script not found: $SCHEMA_SCRIPT"
    exit 1
fi

if [ ! -d "$MIGRATIONS_PATH" ]; then
    log_error "Migrations folder not found: $MIGRATIONS_PATH"
    exit 1
fi

# Check if container exists and is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log_error "Container '$CONTAINER_NAME' is not running"
    exit 1
fi

# Warning prompt
log_warning "This will DROP and RECREATE the database '$DATABASE_NAME'"
log_warning "ALL DATA WILL BE LOST!"
echo -e "${YELLOW}Type 'yes' to continue: ${NC}"
read -r confirmation

if [ "$confirmation" != "yes" ]; then
    echo "Aborted by user."
    exit 0
fi

# Drop database
log_step "Dropping database $DATABASE_NAME"
run_docker exec -u "$DB_SUPERUSER" "$CONTAINER_NAME" psql -U "$DB_SUPERUSER" -c "DROP DATABASE IF EXISTS $DATABASE_NAME;"
log_success "Database dropped"

# Create database
log_step "Creating database $DATABASE_NAME"
run_docker exec -u "$DB_SUPERUSER" "$CONTAINER_NAME" psql -U "$DB_SUPERUSER" -c "CREATE DATABASE $DATABASE_NAME OWNER $DB_SUPERUSER;"
log_success "Database created"

# Copy and apply schema
SCHEMA_FILENAME=$(basename "$SCHEMA_SCRIPT")
SCHEMA_DEST="/tmp/$SCHEMA_FILENAME"

log_step "Copying schema script to container"
run_docker cp "$SCHEMA_SCRIPT" "$CONTAINER_NAME:$SCHEMA_DEST"
log_success "Schema copied"

log_step "Applying base schema"
run_docker exec -u "$DB_SUPERUSER" "$CONTAINER_NAME" psql -U "$DB_SUPERUSER" -d "$DATABASE_NAME" -f "$SCHEMA_DEST"
log_success "Schema applied"

# Apply migrations
log_step "Applying migrations from $MIGRATIONS_PATH"

migration_count=0
for migration_file in $(ls "$MIGRATIONS_PATH"/*.sql 2>/dev/null | sort); do
    migration_name=$(basename "$migration_file")
    migration_dest="/tmp/$migration_name"
    
    echo "  → $migration_name"
    run_docker cp "$migration_file" "$CONTAINER_NAME:$migration_dest"
    run_docker exec -u "$DB_SUPERUSER" "$CONTAINER_NAME" psql -U "$DB_SUPERUSER" -d "$DATABASE_NAME" -f "$migration_dest"
    
    migration_count=$((migration_count + 1))
done

log_success "Applied $migration_count migrations"

# Final message
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Database rebuild complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Database: $DATABASE_NAME"
echo "Container: $CONTAINER_NAME"
echo "Schema: $SCHEMA_SCRIPT"
echo "Migrations: $migration_count applied"
echo ""
log_success "Ready for use"
