#!/bin/bash
# Production Rollback Deployment Script
# This script deploys the rolled-back production configuration

set -e  # Exit on any error

echo "=========================================="
echo "   Production Rollback Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}Step 1: Pulling latest changes...${NC}"
git pull origin master

echo ""
echo -e "${YELLOW}Step 2: Building frontend image...${NC}"
docker build -t kentonel/forson-frontend:latest -f packages/web/Dockerfile packages/web

echo ""
echo -e "${YELLOW}Step 3: Pushing to registry...${NC}"
docker push kentonel/forson-frontend:latest

echo ""
echo -e "${YELLOW}Step 4: Stopping current frontend...${NC}"
docker-compose -f docker-compose.prod.yml stop frontend

echo ""
echo -e "${YELLOW}Step 5: Pulling updated image...${NC}"
docker-compose -f docker-compose.prod.yml pull frontend

echo ""
echo -e "${YELLOW}Step 6: Starting updated frontend...${NC}"
docker-compose -f docker-compose.prod.yml up -d frontend

echo ""
echo -e "${YELLOW}Step 7: Checking frontend health...${NC}"
sleep 5

# Wait for frontend to be healthy
COUNTER=0
MAX_ATTEMPTS=30
until docker-compose -f docker-compose.prod.yml exec -T frontend wget --no-verbose --spider http://localhost/health 2>&1 | grep -q "200 OK" || [ $COUNTER -eq $MAX_ATTEMPTS ]; do
    echo "Waiting for frontend to be healthy... ($COUNTER/$MAX_ATTEMPTS)"
    sleep 2
    COUNTER=$((COUNTER+1))
done

if [ $COUNTER -eq $MAX_ATTEMPTS ]; then
    echo -e "${RED}❌ Frontend failed to become healthy after $MAX_ATTEMPTS attempts${NC}"
    echo ""
    echo "Checking logs:"
    docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Deployment successful!${NC}"
echo ""
echo "=========================================="
echo "   Post-Deployment Checklist"
echo "=========================================="
echo ""
echo "1. Open the application in browser"
echo "2. Press F12 to open developer console"
echo "3. Check for any errors in console"
echo "4. Test key features:"
echo "   - Dashboard loads"
echo "   - Parts page works"
echo "   - POS page works"
echo "   - Cheque printing works"
echo ""
echo "If white screen appears:"
echo "- ErrorBoundary will show detailed error"
echo "- Check console for full stack trace"
echo "- Review sourcemaps for exact error location"
echo ""
echo -e "${YELLOW}Monitoring commands:${NC}"
echo "  docker-compose -f docker-compose.prod.yml logs -f frontend"
echo "  docker-compose -f docker-compose.prod.yml ps"
echo ""
echo -e "${GREEN}Rollback Information:${NC}"
echo "  Commit: d72ab82"
echo "  React: 19.1.0"
echo "  Plugin: @vitejs/plugin-react@4.6.0"
echo "  Vite: 7.0.4"
echo "  Known Good Commit: 00feb95"
echo ""
echo "See ROLLBACK_ANALYSIS.md for complete details"
echo "=========================================="
