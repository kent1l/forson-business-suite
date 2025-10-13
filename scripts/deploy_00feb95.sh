#!/bin/bash
# Deploy Known Good Commit - Last Working Production
# Commit: 00feb95 (Before any React version changes)

set -e

echo "=========================================="
echo "  Deploying Known Good Commit"
echo "  00feb95 - Last Working Production"
echo "=========================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

echo "⚠️  WARNING: This will temporarily checkout an old commit"
echo "   Your current work is safe on branch 'master'"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Save current branch
CURRENT_BRANCH=$(git branch --show-current)
echo "📌 Current branch: $CURRENT_BRANCH"

# Checkout the known good commit
echo "🔄 Checking out commit 00feb95..."
git checkout 00feb95

echo ""
echo "📦 Building frontend from known good commit..."
docker build -t kentonel/forson-frontend:00feb95 \
  -f packages/web/Dockerfile \
  packages/web

echo ""
echo "🏷️  Tagging as latest..."
docker tag kentonel/forson-frontend:00feb95 kentonel/forson-frontend:latest

echo ""
echo "🚀 Pushing to registry..."
docker push kentonel/forson-frontend:latest
docker push kentonel/forson-frontend:00feb95

# Return to original branch
echo ""
echo "🔙 Returning to branch $CURRENT_BRANCH..."
git checkout "$CURRENT_BRANCH"

echo ""
echo "🔄 Deploying to production..."
docker-compose -f docker-compose.prod.yml pull frontend
docker-compose -f docker-compose.prod.yml up -d frontend

echo ""
echo "⏳ Waiting for frontend to be healthy..."
sleep 10

# Check health
docker-compose -f docker-compose.prod.yml exec -T frontend wget --spider -q http://localhost/health
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "Frontend is running with:"
    echo "  - Commit: 00feb95 (known good)"
    echo "  - React 19.1.0"
    echo "  - @vitejs/plugin-react 4.6.0"
    echo ""
    echo "⚠️  NOTE: This is an old version. New features added after"
    echo "   00feb95 will NOT be available (lazy loading, etc.)"
else
    echo ""
    echo "⚠️  Health check failed. Checking logs..."
    docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
fi
