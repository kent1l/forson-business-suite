#!/bin/bash

# React Build Fix - Deployment Script
# This script rebuilds and redeploys the frontend with the React fix

set -e  # Exit on error

echo "🔧 Forson Business Suite - Frontend Rebuild & Redeploy"
echo "======================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: docker-compose.prod.yml not found"
    echo "Please run this script from the project root directory"
    exit 1
fi

# Step 1: Pull latest changes (optional, comment out if already pulled)
echo "📥 Step 1: Pulling latest changes..."
git pull origin master || {
    echo "⚠️  Warning: Could not pull latest changes. Continuing anyway..."
}
echo ""

# Step 2: Build the frontend image
echo "🏗️  Step 2: Building frontend Docker image..."
echo "This may take several minutes..."
docker-compose -f docker-compose.prod.yml build frontend || {
    echo "❌ Error: Failed to build frontend image"
    exit 1
}
echo "✅ Frontend image built successfully"
echo ""

# Step 3: Stop the current frontend container
echo "🛑 Step 3: Stopping current frontend container..."
docker-compose -f docker-compose.prod.yml stop frontend
echo "✅ Frontend container stopped"
echo ""

# Step 4: Remove the old container
echo "🗑️  Step 4: Removing old frontend container..."
docker-compose -f docker-compose.prod.yml rm -f frontend
echo "✅ Old container removed"
echo ""

# Step 5: Start the new frontend container
echo "🚀 Step 5: Starting new frontend container..."
docker-compose -f docker-compose.prod.yml up -d frontend
echo "✅ Frontend container started"
echo ""

# Step 6: Wait a moment for container to initialize
echo "⏳ Waiting for container to initialize..."
sleep 5
echo ""

# Step 7: Check container status
echo "📊 Step 6: Checking container status..."
if docker-compose -f docker-compose.prod.yml ps | grep -q "forson_frontend.*Up"; then
    echo "✅ Frontend container is running"
else
    echo "❌ Warning: Frontend container may not be running properly"
    echo "Showing recent logs:"
    docker-compose -f docker-compose.prod.yml logs --tail=20 frontend
    exit 1
fi
echo ""

# Step 8: Show recent logs
echo "📋 Step 7: Recent container logs:"
docker-compose -f docker-compose.prod.yml logs --tail=10 frontend
echo ""

# Step 9: Test health endpoint
echo "🏥 Step 8: Testing health endpoint..."
if curl -f http://localhost:8090/health > /dev/null 2>&1; then
    echo "✅ Health check passed"
else
    echo "⚠️  Warning: Health check failed or not responding yet"
fi
echo ""

# Final instructions
echo "======================================================"
echo "✅ Deployment Complete!"
echo ""
echo "Next steps:"
echo "1. Open your browser and visit: http://YOUR_IP:8090"
echo "2. Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)"
echo "3. Check browser console for any errors"
echo ""
echo "To monitor logs:"
echo "  docker-compose -f docker-compose.prod.yml logs -f frontend"
echo ""
echo "To check all services:"
echo "  docker-compose -f docker-compose.prod.yml ps"
echo "======================================================"
