#!/bin/bash

# Test Deployment Script - Linux Version
# This script tests the deployment before going to production

set -e  # Exit on error (but we'll handle errors manually)

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Configuration
VERBOSE=false
BUILD_ONLY=false
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Counters
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -b|--build-only)
            BUILD_ONLY=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -v, --verbose     Show detailed output"
            echo "  -b, --build-only  Skip Docker build test"
            echo "  -h, --help        Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Helper functions
print_header() {
    echo -e "\n${CYAN}========================================"
    echo -e "  $1"
    echo -e "========================================${NC}\n"
}

print_section() {
    echo -e "\n${YELLOW}>>> $1${NC}"
    echo -e "${GRAY}-----------------------------------${NC}"
}

print_pass() {
    echo -e "  ${GREEN}[PASS]${NC} $1"
    ((PASS_COUNT++))
}

print_fail() {
    echo -e "  ${RED}[FAIL]${NC} $1"
    ((FAIL_COUNT++))
}

print_warn() {
    echo -e "  ${YELLOW}[WARN]${NC} $1"
    ((WARN_COUNT++))
}

print_info() {
    echo -e "  ${BLUE}[INFO]${NC} $1"
}

verbose_log() {
    if [ "$VERBOSE" = true ]; then
        echo -e "    ${GRAY}$1${NC}"
    fi
}

# Start
print_header "Test Deployment Script"
echo -e "${GRAY}Project: $PROJECT_ROOT${NC}"
echo -e "${GRAY}Mode: $([ "$BUILD_ONLY" = true ] && echo "Build Only" || echo "Full Test")${NC}"
echo -e "${GRAY}Verbose: $VERBOSE${NC}"

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
print_section "Pre-Flight Checks"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_pass "Node.js installed: $NODE_VERSION"
    verbose_log "Node path: $(which node)"
else
    print_fail "Node.js not found"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    print_pass "npm installed: $NPM_VERSION"
    verbose_log "npm path: $(which npm)"
else
    print_fail "npm not found"
    exit 1
fi

# Check Docker (if not build-only)
if [ "$BUILD_ONLY" = false ]; then
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version)
        print_pass "Docker installed: $DOCKER_VERSION"
        verbose_log "Docker path: $(which docker)"
    else
        print_warn "Docker not found (skipping Docker tests)"
        BUILD_ONLY=true
    fi
fi

# Check git status
cd "$PROJECT_ROOT"
if [ -d .git ]; then
    BRANCH=$(git branch --show-current)
    print_info "Current branch: $BRANCH"
    
    if [ -n "$(git status --porcelain)" ]; then
        print_warn "Uncommitted changes detected"
        if [ "$VERBOSE" = true ]; then
            echo -e "${GRAY}Modified files:${NC}"
            git status --short | while read -r line; do
                echo -e "    ${GRAY}$line${NC}"
            done
        fi
    else
        print_pass "Working directory clean"
    fi
fi

# ============================================
# CRITICAL FILE VERIFICATION
# ============================================
print_section "Critical File Verification"

WEB_DIR="$PROJECT_ROOT/packages/web"

# Check MainLayout.jsx
MAIN_LAYOUT="$WEB_DIR/src/components/layout/MainLayout.jsx"
if [ -f "$MAIN_LAYOUT" ]; then
    print_pass "MainLayout.jsx exists"
    
    # Check for React import
    if grep -q "import React" "$MAIN_LAYOUT"; then
        print_pass "MainLayout has React import"
    else
        print_fail "MainLayout missing React import"
    fi
    
    # Check for lazy loading (should NOT exist)
    if grep -q "React.lazy\|import.*lazy.*from 'react'" "$MAIN_LAYOUT"; then
        print_fail "MainLayout still has lazy loading!"
    else
        print_pass "MainLayout has no lazy loading"
    fi
else
    print_fail "MainLayout.jsx not found"
fi

# Check RefundForm.jsx
REFUND_FORM="$WEB_DIR/src/components/refunds/RefundForm.jsx"
if [ -f "$REFUND_FORM" ]; then
    print_pass "RefundForm.jsx exists"
    
    if grep -q "import React" "$REFUND_FORM"; then
        print_pass "RefundForm has React import"
    else
        print_fail "RefundForm missing React import"
    fi
else
    print_fail "RefundForm.jsx not found"
fi

# Check SplitPaymentModal.jsx
SPLIT_MODAL="$WEB_DIR/src/components/ui/SplitPaymentModal.jsx"
if [ -f "$SPLIT_MODAL" ]; then
    print_pass "SplitPaymentModal.jsx exists"
    
    if grep -q "import React" "$SPLIT_MODAL"; then
        print_pass "SplitPaymentModal has React import"
    else
        print_fail "SplitPaymentModal missing React import"
    fi
else
    print_fail "SplitPaymentModal.jsx not found"
fi

# Check PurchaseOrderPage.jsx
PO_PAGE="$WEB_DIR/src/pages/PurchaseOrderPage.jsx"
if [ -f "$PO_PAGE" ]; then
    print_pass "PurchaseOrderPage.jsx exists"
    
    # Check for direct import (not lazy)
    if grep -q "import PurchaseOrderEditorPage from" "$PO_PAGE"; then
        print_pass "PurchaseOrderPage has direct import"
    elif grep -q "React.lazy.*PurchaseOrderEditorPage\|const PurchaseOrderEditorPage = lazy" "$PO_PAGE"; then
        print_fail "PurchaseOrderPage still uses lazy loading!"
    else
        print_warn "PurchaseOrderPage import status unclear"
    fi
else
    print_fail "PurchaseOrderPage.jsx not found"
fi

# Check package.json versions
PACKAGE_JSON="$WEB_DIR/package.json"
if [ -f "$PACKAGE_JSON" ]; then
    print_pass "package.json exists"
    
    REACT_VERSION=$(grep -oP '"react":\s*"\^\K[^"]+' "$PACKAGE_JSON" || echo "not found")
    PLUGIN_VERSION=$(grep -oP '"@vitejs/plugin-react":\s*"\^\K[^"]+' "$PACKAGE_JSON" || echo "not found")
    
    print_info "React version: $REACT_VERSION"
    print_info "Plugin version: $PLUGIN_VERSION"
    
    if [ "$REACT_VERSION" = "19.2.0" ] && [ "$PLUGIN_VERSION" = "5.0.4" ]; then
        print_pass "Dependency versions match expected (19.2.0 + 5.0.4)"
    elif [ "$REACT_VERSION" = "19.1.0" ] && [ "$PLUGIN_VERSION" = "4.6.0" ]; then
        print_warn "Using old working versions (19.1.0 + 4.6.0)"
    else
        print_warn "Unexpected dependency versions"
    fi
else
    print_fail "package.json not found"
fi

# ============================================
# BUILD TESTING
# ============================================
print_section "Build Testing"

cd "$WEB_DIR"

# Clean previous build
if [ -d "dist" ]; then
    print_info "Cleaning previous build..."
    rm -rf dist
    verbose_log "Removed dist directory"
fi

# Run build
print_info "Running npm run build..."
echo ""

START_TIME=$(date +%s)

if [ "$VERBOSE" = true ]; then
    npm run build
    BUILD_EXIT=$?
else
    npm run build > /tmp/build-output.log 2>&1
    BUILD_EXIT=$?
    if [ $BUILD_EXIT -ne 0 ]; then
        cat /tmp/build-output.log
    fi
fi

END_TIME=$(date +%s)
BUILD_TIME=$((END_TIME - START_TIME))

echo ""

if [ $BUILD_EXIT -eq 0 ]; then
    print_pass "Build completed successfully in ${BUILD_TIME}s"
else
    print_fail "Build failed with exit code $BUILD_EXIT"
    echo ""
    echo -e "${RED}Build output:${NC}"
    if [ "$VERBOSE" = false ]; then
        cat /tmp/build-output.log
    fi
    exit 1
fi

# ============================================
# BUILD OUTPUT VERIFICATION
# ============================================
print_section "Build Output Verification"

# Check dist directory
if [ -d "dist" ]; then
    print_pass "dist directory created"
else
    print_fail "dist directory not found"
    exit 1
fi

# Check index.html
if [ -f "dist/index.html" ]; then
    print_pass "index.html exists"
    verbose_log "Size: $(du -h dist/index.html | cut -f1)"
else
    print_fail "index.html not found"
fi

# Check assets directory
if [ -d "dist/assets" ]; then
    print_pass "assets directory exists"
    
    ASSET_COUNT=$(ls -1 dist/assets | wc -l)
    print_info "Found $ASSET_COUNT asset files"
    
    if [ "$VERBOSE" = true ]; then
        echo -e "${GRAY}Asset files:${NC}"
        ls -lh dist/assets | tail -n +2 | while read -r line; do
            echo -e "    ${GRAY}$line${NC}"
        done
    fi
else
    print_fail "assets directory not found"
fi

# Check for vendor bundles
VENDOR_REACT=$(ls dist/assets/vendor-react-*.js 2>/dev/null | head -n1)
if [ -n "$VENDOR_REACT" ]; then
    SIZE=$(du -h "$VENDOR_REACT" | cut -f1)
    print_pass "React vendor bundle exists: $(basename "$VENDOR_REACT") ($SIZE)"
    
    # Check size (should be around 300-400KB)
    SIZE_BYTES=$(stat -f%z "$VENDOR_REACT" 2>/dev/null || stat -c%s "$VENDOR_REACT" 2>/dev/null)
    SIZE_KB=$((SIZE_BYTES / 1024))
    
    if [ $SIZE_KB -lt 200 ]; then
        print_warn "React bundle seems small ($SIZE_KB KB) - might be incomplete"
    elif [ $SIZE_KB -gt 600 ]; then
        print_warn "React bundle seems large ($SIZE_KB KB) - might have duplicates"
    else
        verbose_log "Bundle size: $SIZE_KB KB (normal range)"
    fi
else
    print_fail "React vendor bundle not found"
fi

VENDOR_MISC=$(ls dist/assets/vendor-misc-*.js 2>/dev/null | head -n1)
if [ -n "$VENDOR_MISC" ]; then
    SIZE=$(du -h "$VENDOR_MISC" | cut -f1)
    print_pass "Misc vendor bundle exists: $(basename "$VENDOR_MISC") ($SIZE)"
else
    print_warn "Misc vendor bundle not found (might be optional)"
fi

# Check main bundle
MAIN_BUNDLE=$(ls dist/assets/index-*.js 2>/dev/null | head -n1)
if [ -n "$MAIN_BUNDLE" ]; then
    SIZE=$(du -h "$MAIN_BUNDLE" | cut -f1)
    print_pass "Main bundle exists: $(basename "$MAIN_BUNDLE") ($SIZE)"
else
    print_fail "Main bundle not found"
fi

# Check CSS
CSS_FILE=$(ls dist/assets/index-*.css 2>/dev/null | head -n1)
if [ -n "$CSS_FILE" ]; then
    SIZE=$(du -h "$CSS_FILE" | cut -f1)
    print_pass "CSS bundle exists: $(basename "$CSS_FILE") ($SIZE)"
else
    print_warn "CSS bundle not found"
fi

# Check for unexpected lazy-loaded chunks
print_info "Checking for lazy-loaded chunks..."
LAZY_CHUNKS=$(ls dist/assets/ 2>/dev/null | grep -v "vendor-" | grep -v "index-" | grep "\.js$" || echo "")
if [ -z "$LAZY_CHUNKS" ]; then
    print_pass "No unexpected lazy-loaded chunks"
else
    print_warn "Found potential lazy-loaded chunks:"
    echo "$LAZY_CHUNKS" | while read -r chunk; do
        echo -e "    ${YELLOW}- $chunk${NC}"
    done
fi

# ============================================
# BUNDLE CONTENT ANALYSIS
# ============================================
print_section "Bundle Content Analysis"

if [ -n "$VENDOR_REACT" ]; then
    # Check for React in bundle
    if grep -q "react" "$VENDOR_REACT"; then
        print_pass "React code found in vendor bundle"
    else
        print_fail "React code NOT found in vendor bundle"
    fi
    
    # Check for duplicate React (simple heuristic)
    REACT_COUNT=$(grep -o "react" "$VENDOR_REACT" | wc -l)
    verbose_log "React string occurrences: $REACT_COUNT"
    
    if [ $REACT_COUNT -gt 1000 ]; then
        print_warn "Very high React occurrences ($REACT_COUNT) - might indicate duplication"
    fi
fi

# Check index.html references
if [ -f "dist/index.html" ]; then
    print_info "Checking index.html script references..."
    
    SCRIPT_REFS=$(grep -o 'src="/assets/[^"]*\.js"' dist/index.html | sed 's/src="\/assets\///' | sed 's/"//')
    
    if [ -n "$SCRIPT_REFS" ]; then
        ALL_FOUND=true
        echo "$SCRIPT_REFS" | while read -r ref; do
            if [ -f "dist/assets/$ref" ]; then
                verbose_log "✓ $ref exists"
            else
                echo -e "    ${RED}✗ $ref MISSING${NC}"
                ALL_FOUND=false
            fi
        done
        
        if [ "$ALL_FOUND" = true ]; then
            print_pass "All referenced scripts exist"
        fi
    else
        print_warn "No script references found in index.html"
    fi
fi

# ============================================
# DOCKER BUILD TEST (Optional)
# ============================================
if [ "$BUILD_ONLY" = false ]; then
    print_section "Docker Build Test"
    
    cd "$PROJECT_ROOT"
    
    print_info "Building Docker image (this may take a few minutes)..."
    echo ""
    
    START_TIME=$(date +%s)
    
    if [ "$VERBOSE" = true ]; then
        docker-compose -f docker-compose.prod.yml build web
        DOCKER_EXIT=$?
    else
        docker-compose -f docker-compose.prod.yml build web > /tmp/docker-build.log 2>&1
        DOCKER_EXIT=$?
        if [ $DOCKER_EXIT -ne 0 ]; then
            cat /tmp/docker-build.log
        fi
    fi
    
    END_TIME=$(date +%s)
    DOCKER_TIME=$((END_TIME - START_TIME))
    
    echo ""
    
    if [ $DOCKER_EXIT -eq 0 ]; then
        print_pass "Docker build completed successfully in ${DOCKER_TIME}s"
    else
        print_fail "Docker build failed"
        if [ "$VERBOSE" = false ]; then
            echo ""
            echo -e "${RED}Docker build output:${NC}"
            cat /tmp/docker-build.log
        fi
    fi
else
    print_info "Skipping Docker build (--build-only flag)"
fi

# ============================================
# SUMMARY
# ============================================
print_header "Test Summary"

echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"
echo -e "${YELLOW}Warnings: $WARN_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✓ All critical tests passed!${NC}"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo -e "  1. Test locally: ${GRAY}npm run preview${NC} (in packages/web)"
    echo -e "  2. Deploy to staging: ${GRAY}./scripts/deploy_production.sh${NC}"
    echo -e "  3. Verify in browser (check console for errors)"
    echo -e "  4. If issues, run: ${GRAY}./scripts/investigate-errors.sh --all${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please fix the issues above.${NC}"
    echo ""
    echo -e "${CYAN}Troubleshooting:${NC}"
    echo -e "  1. Review failed checks above"
    echo -e "  2. Run with --verbose for more details"
    echo -e "  3. Check WHITE_SCREEN_ANALYSIS.md for guidance"
    echo -e "  4. Run: ${GRAY}./scripts/investigate-errors.sh --all${NC}"
    echo ""
    exit 1
fi
