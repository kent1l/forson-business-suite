#!/bin/bash
# Quick Production Deployment - Current Commit
# Commit: ec7218b - React 19.2.0 + Plugin 5.0.4

set -e

echo "=========================================="
echo "  Deploying Current HEAD (ec7218b)"
echo "  React 19.2.0 + Plugin 5.0.4"
echo "=========================================="
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

echo "📦 Building frontend Docker image..."
docker build -t kentonel/forson-frontend:latest \
  -f packages/web/Dockerfile \
  packages/web

echo ""
echo "🚀 Pushing to registry..."
docker push kentonel/forson-frontend:latest

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
    echo "  - React 19.2.0"
    echo "  - @vitejs/plugin-react 5.0.4"
    echo "  - Vite 7.1.9"
    echo "  - ErrorBoundary enabled"
    echo "  - Sourcemaps enabled"
else
    echo ""
    echo "⚠️  Health check failed. Checking logs..."
    docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
fi
