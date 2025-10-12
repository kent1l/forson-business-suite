#!/bin/bash
# Debug script to diagnose React bundle issues

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 React Bundle Diagnostics"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_DIR"

# Check if container is running
if ! docker ps | grep -q forson_frontend; then
    echo "❌ Frontend container is not running"
    exit 1
fi

echo "📦 Container: forson_frontend"
echo ""

# 1. List all assets
echo "━━━ All Assets ━━━"
docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/
echo ""

# 2. Find vendor-react file
VENDOR_REACT=$(docker exec forson_frontend ls /usr/share/nginx/html/assets/ | grep vendor-react)
if [ -z "$VENDOR_REACT" ]; then
    echo "❌ No vendor-react file found"
    exit 1
fi

echo "━━━ Vendor React File ━━━"
echo "  File: $VENDOR_REACT"
SIZE=$(docker exec forson_frontend stat -c%s "/usr/share/nginx/html/assets/$VENDOR_REACT")
echo "  Size: $SIZE bytes"
echo ""

# 3. Extract React version from bundle
echo "━━━ React Version in Bundle ━━━"
docker exec forson_frontend grep -o 'version":"[0-9.]*"' "/usr/share/nginx/html/assets/$VENDOR_REACT" | head -3
echo ""

# 4. Check for multiple React exports
echo "━━━ React Export Patterns ━━━"
echo "Checking for 'he.Activity=' pattern:"
docker exec forson_frontend grep -c 'he\.Activity=' "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"

echo "Checking for 'he.Children=' pattern:"
docker exec forson_frontend grep -c 'he\.Children=' "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"

echo "Checking for 'ge.Activity=' pattern:"
docker exec forson_frontend grep -c 'ge\.Activity=' "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"

echo "Checking for 'ge.Children=' pattern:"
docker exec forson_frontend grep -c 'ge\.Children=' "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"
echo ""

# 5. Extract first 300 lines to check initialization
echo "━━━ Bundle Header (first 300 lines) ━━━"
docker exec forson_frontend sed -n '1,300p' "/usr/share/nginx/html/assets/$VENDOR_REACT" > /tmp/vendor-react-header.js
echo "Saved to: /tmp/vendor-react-header.js"
echo ""
echo "Checking for React module patterns:"
grep -n "var he=" /tmp/vendor-react-header.js || echo "  'var he=' not found in header"
grep -n "var ge=" /tmp/vendor-react-header.js || echo "  'var ge=' not found in header"
grep -n "return he" /tmp/vendor-react-header.js | head -3 || echo "  'return he' not found in header"
grep -n "return ge" /tmp/vendor-react-header.js | head -3 || echo "  'return ge' not found in header"
echo ""

# 6. Check for duplicate React symbols
echo "━━━ Duplicate React Detection ━━━"
echo "Checking for Symbol.for('react.element'):"
docker exec forson_frontend grep -c "Symbol\.for(\"react\.element\")" "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"

echo "Checking for Symbol.for('react.transitional.element'):"
docker exec forson_frontend grep -c "Symbol\.for(\"react\.transitional\.element\")" "/usr/share/nginx/html/assets/$VENDOR_REACT" || echo "  Not found"
echo ""

# 7. Extract the error location context
echo "━━━ Error Context (line 17 area) ━━━"
echo "Extracting lines 4540-4580 from bundle (where Activity assignment happens):"
docker exec forson_frontend sed -n '4540,4580p' "/usr/share/nginx/html/assets/$VENDOR_REACT" > /tmp/vendor-react-error-context.js
cat /tmp/vendor-react-error-context.js
echo ""
echo "Saved to: /tmp/vendor-react-error-context.js"
echo ""

# 8. Check vendor-misc for React dependencies
echo "━━━ Vendor Misc Check ━━━"
VENDOR_MISC=$(docker exec forson_frontend ls /usr/share/nginx/html/assets/ | grep vendor-misc)
if [ -n "$VENDOR_MISC" ]; then
    echo "  File: $VENDOR_MISC"
    echo "  Checking for React imports:"
    docker exec forson_frontend grep -c "from.*vendor-react" "/usr/share/nginx/html/assets/$VENDOR_MISC" || echo "    No vendor-react imports found"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Diagnostics Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Debug files created:"
echo "  - /tmp/vendor-react-header.js"
echo "  - /tmp/vendor-react-error-context.js"
echo ""
echo "To investigate further, examine these files for:"
echo "  1. Where 'he' or 'ge' is declared"
echo "  2. Whether it's initialized before use"
echo "  3. If there are multiple React module definitions"
