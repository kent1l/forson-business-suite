#!/bin/bash
# Simple Deploy Script - No directory changes needed
# Run from project root: ./scripts/simple_deploy.sh

set -e

echo "🚀 Forson Business Suite - Simple Deploy"
echo "========================================"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: Please run from project root directory"
    exit 1
fi

echo "✅ Detected project directory: $(pwd)"
echo ""

echo "🏗️  Building frontend (this may take 5-10 minutes)..."
docker-compose -f docker-compose.prod.yml build --no-cache frontend

echo ""
echo "🔄 Restarting frontend container..."
docker-compose -f docker-compose.prod.yml up -d --force-recreate frontend

echo ""
echo "⏳ Waiting for container to start..."
sleep 5

echo ""
echo "📊 Container status:"
docker-compose -f docker-compose.prod.yml ps frontend

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Open browser: http://YOUR_IP:8090"
echo "  2. Hard refresh: Ctrl+F5"
echo "  3. Check console for errors"
echo ""
echo "Monitor logs:"
echo "  docker-compose -f docker-compose.prod.yml logs -f frontend"
