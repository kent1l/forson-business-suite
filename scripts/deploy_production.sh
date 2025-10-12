#!/bin/bash
# Quick Deploy Script for Production
# This script automates the initial production deployment

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "========================================="
echo "  Forson Business Suite"
echo "  Production Quick Deploy"
echo "========================================="
echo -e "${NC}"

# Step 1: Check readiness
echo -e "${BLUE}Step 1: Running production readiness checks...${NC}"
if [ -f "scripts/check_production_readiness.sh" ]; then
    bash scripts/check_production_readiness.sh
    if [ $? -ne 0 ]; then
        echo -e "${RED}Readiness check failed. Please fix errors before continuing.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Warning: Readiness check script not found, skipping...${NC}"
fi

echo ""

# Step 2: Pull images
echo -e "${BLUE}Step 2: Pulling Docker images...${NC}"
docker compose -f docker-compose.prod.yml pull

echo ""

# Step 3: Start services
echo -e "${BLUE}Step 3: Starting services...${NC}"
docker compose -f docker-compose.prod.yml up -d

echo ""

# Step 4: Wait for database
echo -e "${BLUE}Step 4: Waiting for database to be ready...${NC}"
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if docker exec forson_db pg_isready -U postgres -d forson_business_suite > /dev/null 2>&1; then
        echo -e "${GREEN}Database is ready!${NC}"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "Waiting for database... ($ATTEMPT/$MAX_ATTEMPTS)"
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo -e "${RED}Database failed to become ready in time${NC}"
    exit 1
fi

echo ""

# Step 5: Initialize database
echo -e "${BLUE}Step 5: Initializing database schema...${NC}"
read -p "Is this a fresh install? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Applying initial schema..."
    docker cp ./database/initial_schema.sql forson_db:/tmp/initial_schema.sql
    docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/initial_schema.sql
    
    echo "Applying migrations..."
    for f in database/migrations/*.sql; do
        if [ -f "$f" ]; then
            echo "  - $(basename $f)"
            docker cp "$f" forson_db:/tmp/$(basename "$f")
            docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
        fi
    done
    
    echo -e "${GREEN}Database initialized successfully!${NC}"
else
    echo "Skipping database initialization (existing database assumed)"
fi

echo ""

# Step 6: Check service health
echo -e "${BLUE}Step 6: Checking service health...${NC}"
sleep 5
docker compose -f docker-compose.prod.yml ps

echo ""

# Final status
echo -e "${GREEN}========================================="
echo "  Deployment Complete!"
echo "=========================================${NC}"
echo ""
echo "Services:"
echo "  - Frontend: http://localhost:8090"
echo "  - Backend API: http://localhost:3001"
echo "  - Meilisearch: http://localhost:7700"
echo ""
echo "Next steps:"
echo "  1. Create an admin user (see PRODUCTION_DEPLOYMENT.md)"
echo "  2. Configure SSL/TLS for HTTPS"
echo "  3. Set up external monitoring"
echo "  4. Test backups are working"
echo ""
echo "View logs: docker compose -f docker-compose.prod.yml logs -f"
echo "Stop services: docker compose -f docker-compose.prod.yml down"
echo ""
