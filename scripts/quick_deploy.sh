#!/bin/bash
# Quick Deploy - Run this on your remote machine

set -e

echo "🚀 Forson Business Suite - Quick Fix Deploy"
echo "==========================================="
echo ""
echo "This fixes:"
echo "  1. White screen (React error)"
echo "  2. Build failure (Rollup binary)"
echo ""

cd ~/docker/forson-business-suite

echo "📥 Pulling latest changes..."
git pull origin master

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
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "  1. Open browser: http://YOUR_IP:8090"
echo "  2. Hard refresh: Ctrl+F5"
echo "  3. Check console for errors"
echo ""
echo "Monitor logs: docker-compose -f docker-compose.prod.yml logs -f frontend"
