#!/bin/bash
# Comprehensive verification and rebuild script for production deployment

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Forson Business Suite - Production Rebuild Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_DIR"

echo "📂 Project directory: $PROJECT_DIR"
echo ""

# Step 1: Verify git status
echo "━━━ Step 1: Git Status ━━━"
echo "Current commit:"
git log --oneline -1
echo ""
echo "Branch status:"
git status -sb
echo ""

# Step 2: Check if container exists
echo "━━━ Step 2: Current Container State ━━━"
if docker ps -a | grep -q forson_frontend; then
    echo "✓ Frontend container exists"
    if docker ps | grep -q forson_frontend; then
        echo "✓ Frontend container is running"
        echo ""
        echo "Current assets in container:"
        docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/ | grep vendor-react || echo "  No vendor-react file found"
        echo ""
        CURRENT_HASH=$(docker exec forson_frontend ls /usr/share/nginx/html/assets/ | grep vendor-react | cut -d'-' -f3 | cut -d'.' -f1)
        if [ -n "$CURRENT_HASH" ]; then
            echo "  Current vendor-react hash: $CURRENT_HASH"
        fi
    else
        echo "⚠️  Frontend container is stopped"
    fi
else
    echo "⚠️  Frontend container does not exist"
fi
echo ""

# Step 3: Build expected hash from local source
echo "━━━ Step 3: Expected Build Output ━━━"
echo "Building locally to determine expected hash..."
npm run build --workspace packages/web 2>&1 | tail -5 | grep vendor-react || echo "  Could not determine hash from build"
echo ""

# Step 4: Ask user to confirm rebuild
echo "━━━ Step 4: Rebuild Decision ━━━"
read -p "Do you want to rebuild the frontend container? (yes/no): " CONFIRM
echo ""

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Rebuild cancelled by user"
    exit 0
fi

# Step 5: Rebuild with no cache
echo "━━━ Step 5: Rebuilding Frontend ━━━"
echo "This will take 5-10 minutes..."
echo ""
docker compose -f docker-compose.prod.yml build --no-cache --progress=plain frontend 2>&1 | tee /tmp/frontend-build.log

BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
    echo ""
    echo "❌ Build failed with exit code $BUILD_EXIT"
    echo "Check /tmp/frontend-build.log for details"
    exit 1
fi

echo ""
echo "✓ Build completed successfully"
echo ""

# Step 6: Restart container
echo "━━━ Step 6: Restarting Frontend Container ━━━"
docker compose -f docker-compose.prod.yml up -d --force-recreate frontend

echo ""
echo "⏳ Waiting 5 seconds for container to start..."
sleep 5
echo ""

# Step 7: Verify new assets
echo "━━━ Step 7: Verification ━━━"
if docker ps | grep -q forson_frontend; then
    echo "✓ Frontend container is running"
    echo ""
    echo "New assets in container:"
    docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/ | grep vendor-react || echo "  ERROR: No vendor-react file found!"
    echo ""
    NEW_HASH=$(docker exec forson_frontend ls /usr/share/nginx/html/assets/ | grep vendor-react | cut -d'-' -f3 | cut -d'.' -f1)
    if [ -n "$NEW_HASH" ]; then
        echo "  New vendor-react hash: $NEW_HASH"
        if [ "$NEW_HASH" != "$CURRENT_HASH" ]; then
            echo "  ✓ Hash changed from $CURRENT_HASH to $NEW_HASH"
        else
            echo "  ⚠️  Hash is the same as before ($CURRENT_HASH)"
        fi
    fi
else
    echo "❌ Frontend container failed to start"
    exit 1
fi
echo ""

# Step 8: Check React version in bundle
echo "━━━ Step 8: React Version Check ━━━"
echo "Checking React version in bundle..."
REACT_VERSION=$(docker exec forson_frontend grep -o '"version":"[0-9.]*"' /usr/share/nginx/html/assets/vendor-react-*.js | head -1 | cut -d'"' -f4)
if [ -n "$REACT_VERSION" ]; then
    echo "  React version in bundle: $REACT_VERSION"
    if [ "$REACT_VERSION" = "19.2.0" ]; then
        echo "  ✓ Correct React version (19.2.0)"
    else
        echo "  ⚠️  Unexpected React version (expected 19.2.0)"
    fi
else
    echo "  ⚠️  Could not determine React version"
fi
echo ""

# Final instructions
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Open browser: http://YOUR_IP:8090"
echo "  2. Hard refresh: Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)"
echo "  3. Check browser console for errors"
echo ""
echo "Monitor logs:"
echo "  docker compose -f docker-compose.prod.yml logs -f frontend"
echo ""
echo "If issues persist:"
echo "  1. Check browser console for the exact error"
echo "  2. Verify the vendor-react hash matches: $NEW_HASH"
echo "  3. Clear browser cache completely"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
