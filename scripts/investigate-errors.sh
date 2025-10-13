#!/bin/bash

# Error Investigation Script - Linux Version
# This script helps diagnose white screen and production errors

set +e  # Don't exit on error

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# Configuration
CHECK_BUILD=false
CHECK_DOCKER=false
CHECK_BROWSER=false
CHECK_NETWORK=false
CHECK_ALL=false

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse arguments
if [ $# -eq 0 ]; then
    CHECK_ALL=true
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --build|--check-build-output)
            CHECK_BUILD=true
            shift
            ;;
        --docker|--check-docker-logs)
            CHECK_DOCKER=true
            shift
            ;;
        --browser|--check-browser-console)
            CHECK_BROWSER=true
            shift
            ;;
        --network|--check-network-requests)
            CHECK_NETWORK=true
            shift
            ;;
        --all|-a)
            CHECK_ALL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --build     Check build output for errors"
            echo "  --docker    Check Docker logs"
            echo "  --browser   Show browser console error guide"
            echo "  --network   Show network request patterns"
            echo "  --all, -a   Run all checks (default if no options)"
            echo "  -h, --help  Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# If --all or no flags, enable all checks
if [ "$CHECK_ALL" = true ]; then
    CHECK_BUILD=true
    CHECK_DOCKER=true
    CHECK_BROWSER=true
    CHECK_NETWORK=true
fi

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

print_finding() {
    local TYPE=$1
    local MESSAGE=$2
    
    case $TYPE in
        ERROR)
            echo -e "  ${RED}[ERROR]${NC} $MESSAGE"
            ;;
        WARNING)
            echo -e "  ${YELLOW}[WARNING]${NC} $MESSAGE"
            ;;
        INFO)
            echo -e "  ${CYAN}[INFO]${NC} $MESSAGE"
            ;;
        SUCCESS)
            echo -e "  ${GREEN}[SUCCESS]${NC} $MESSAGE"
            ;;
        *)
            echo -e "  $MESSAGE"
            ;;
    esac
}

# Start
print_header "Error Investigation Script"

# ============================================
# 1. Check Build Output for Errors
# ============================================
if [ "$CHECK_BUILD" = true ]; then
    print_section "Checking Build Output"
    
    cd "$PROJECT_ROOT/packages/web"
    
    # Check if dist exists
    if [ ! -d "dist" ]; then
        print_finding ERROR "dist directory doesn't exist. Build may have failed."
        echo -e "    ${GRAY}Run: npm run build${NC}"
    else
        print_finding SUCCESS "dist directory exists"
        
        # List all generated files
        echo ""
        echo -e "  ${NC}Generated files:${NC}"
        if [ -d "dist/assets" ]; then
            ls -lh dist/assets | tail -n +2 | while read -r line; do
                SIZE=$(echo "$line" | awk '{print $5}')
                NAME=$(echo "$line" | awk '{print $9}')
                echo -e "    ${GRAY}$NAME - $SIZE${NC}"
            done
        fi
        
        # Check for critical files
        echo ""
        REACT_BUNDLE=$(ls dist/assets/vendor-react-*.js 2>/dev/null | head -n1)
        if [ -n "$REACT_BUNDLE" ]; then
            BUNDLE_NAME=$(basename "$REACT_BUNDLE")
            print_finding SUCCESS "React vendor bundle found: $BUNDLE_NAME"
            
            # Check for React duplication
            REACT_COUNT=$(grep -o "react" "$REACT_BUNDLE" | wc -l)
            if [ $REACT_COUNT -gt 100 ]; then
                print_finding WARNING "React bundle is very large ($REACT_COUNT React references)"
                echo -e "    ${YELLOW}This might indicate duplicate React instances${NC}"
            fi
        else
            print_finding ERROR "React vendor bundle NOT found!"
        fi
        
        # Check index.html
        if [ -f "dist/index.html" ]; then
            echo ""
            echo -e "  ${NC}index.html script references:${NC}"
            grep -o 'src="/assets/[^"]*\.js"' dist/index.html | sed 's/src="//' | sed 's/"//' | while read -r src; do
                echo -e "    ${GRAY}- $src${NC}"
            done
            
            # Check for missing chunks
            echo ""
            grep -o '/assets/[^"]*\.js' dist/index.html | sed 's/\/assets\///' | while read -r fileName; do
                if [ ! -f "dist/assets/$fileName" ]; then
                    print_finding ERROR "Referenced file missing: $fileName"
                fi
            done
        fi
    fi
fi

# ============================================
# 2. Check Docker Logs
# ============================================
if [ "$CHECK_DOCKER" = true ]; then
    print_section "Checking Docker Logs"
    
    cd "$PROJECT_ROOT"
    
    # Check if containers are running
    echo -e "  ${NC}Checking running containers...${NC}"
    
    # Try both docker compose and docker-compose commands
    if docker compose ps --filter "name=forson" --format "{{.Names}} - {{.Status}}" 2>/dev/null | grep -q .; then
        DOCKER_CMD="docker compose"
        CONTAINERS=$(docker compose ps --filter "name=forson" --format "{{.Names}} - {{.Status}}")
    elif docker-compose ps --filter "name=forson" --format "{{.Names}} - {{.Status}}" 2>/dev/null | grep -q .; then
        DOCKER_CMD="docker-compose"
        CONTAINERS=$(docker-compose ps --filter "name=forson" --format "{{.Names}} - {{.Status}}")
    else
        print_finding WARNING "No Forson containers are running"
        echo -e "    ${GRAY}Start containers: docker compose -f docker-compose.prod.yml up -d${NC}"
        echo -e "    ${GRAY}Or: docker-compose -f docker-compose.prod.yml up -d${NC}"
        CONTAINERS=""
    fi
    
    if [ -n "$CONTAINERS" ]; then
        echo ""
        echo "$CONTAINERS" | while read -r line; do
            echo -e "    ${GREEN}$line${NC}"
        done
        
        # Get web container logs
        echo ""
        echo -e "  ${NC}Recent web container logs (last 50 lines):${NC}"
        echo ""
        if [ "$DOCKER_CMD" = "docker compose" ]; then
            $DOCKER_CMD -f docker-compose.prod.yml logs --tail=50 web 2>/dev/null || \
                echo -e "    ${YELLOW}Could not retrieve logs. Is docker compose running?${NC}"
        else
            $DOCKER_CMD -f docker-compose.prod.yml logs --tail=50 web 2>/dev/null || \
                echo -e "    ${YELLOW}Could not retrieve logs. Is docker-compose running?${NC}"
        fi
        
        # Check for common error patterns
        echo ""
        echo -e "  ${NC}Checking for common errors...${NC}"
        if [ "$DOCKER_CMD" = "docker compose" ]; then
            LOGS=$($DOCKER_CMD -f docker-compose.prod.yml logs web 2>&1 || echo "")
        else
            LOGS=$($DOCKER_CMD -f docker-compose.prod.yml logs web 2>&1 || echo "")
        fi
        
        if echo "$LOGS" | grep -qi "error"; then
            print_finding ERROR "Found error messages in logs"
            echo "$LOGS" | grep -i "error" | head -10 | while read -r line; do
                echo -e "    ${RED}$line${NC}"
            done
        fi
        
        if echo "$LOGS" | grep -qi "ENOENT\|Cannot find module"; then
            print_finding ERROR "Missing module errors detected"
        fi
        
        if echo "$LOGS" | grep -qi "ECONNREFUSED"; then
            print_finding ERROR "Connection refused errors detected"
        fi
        
        if echo "$LOGS" | grep -qi "webpack\|bundle\|chunk"; then
            print_finding WARNING "Build/bundle related messages found"
        fi
    fi
fi

# ============================================
# 3. Browser Console Errors Guide
# ============================================
if [ "$CHECK_BROWSER" = true ]; then
    print_section "Browser Console Error Checklist"
    
    echo -e "  ${NC}To check browser console errors:${NC}"
    echo ""
    echo -e "  ${GRAY}1. Open your application in browser${NC}"
    echo -e "     ${GRAY}Development: http://localhost:5173${NC}"
    echo -e "     ${GRAY}Production:  http://localhost:5000 (or your server)${NC}"
    echo ""
    echo -e "  ${GRAY}2. Open Developer Tools (F12 or Ctrl+Shift+I)${NC}"
    echo ""
    echo -e "  ${GRAY}3. Check Console tab for errors${NC}"
    echo ""
    echo -e "  ${NC}Common errors to look for:${NC}"
    echo ""
    
    # Error patterns array
    declare -a patterns=(
        "Cannot set properties of undefined|React import missing or module not loaded|Check React imports in components"
        "Cannot read property 'map' of undefined|API response not validated|Add defensive checks: response.data || []"
        "Failed to fetch|Network/API request failed|Check API server is running and accessible"
        "Uncaught SyntaxError|JavaScript parsing error|Check bundle integrity, rebuild"
        "Loading chunk .* failed|Lazy-loaded chunk not found|Verify all chunks built, check paths"
        "React is not defined|React not in scope|Add 'import React' to component"
        "undefined is not a function|Function/method doesn't exist|Check import statements and exports"
        "Hydration error|SSR/client mismatch|Check for server/client differences"
    )
    
    for pattern in "${patterns[@]}"; do
        IFS='|' read -r error_pattern meaning fix <<< "$pattern"
        echo -e "  ${YELLOW}Error Pattern:${NC} ${RED}$error_pattern${NC}"
        echo -e "    ${GRAY}Meaning: $meaning${NC}"
        echo -e "    ${CYAN}Fix: $fix${NC}"
        echo ""
    done
    
    echo -e "  ${GRAY}4. Check Network tab${NC}"
    echo -e "     ${GRAY}- Look for failed requests (red)${NC}"
    echo -e "     ${GRAY}- Check for 404 errors on chunk files${NC}"
    echo -e "     ${GRAY}- Verify all assets loaded successfully${NC}"
    echo ""
    echo -e "  ${GRAY}5. If white screen with no console errors:${NC}"
    echo -e "     ${GRAY}- Check if main bundle loaded (Network tab)${NC}"
    echo -e "     ${GRAY}- Check if React initialized (React DevTools)${NC}"
    echo -e "     ${GRAY}- Check Docker/server logs for startup errors${NC}"
fi

# ============================================
# 4. Network Request Patterns
# ============================================
if [ "$CHECK_NETWORK" = true ]; then
    print_section "Network Request Patterns to Check"
    
    echo -e "  ${NC}Expected requests in Network tab:${NC}"
    echo ""
    echo -e "  ${CYAN}Initial Page Load:${NC}"
    echo -e "    ${GRAY}GET / (200) - Should return index.html${NC}"
    echo -e "    ${GRAY}GET /assets/index-*.css (200) - Main stylesheet${NC}"
    echo -e "    ${GRAY}GET /assets/vendor-react-*.js (200) - React vendor bundle${NC}"
    echo -e "    ${GRAY}GET /assets/vendor-misc-*.js (200) - Other vendors${NC}"
    echo -e "    ${GRAY}GET /assets/index-*.js (200) - Main app bundle${NC}"
    echo ""
    echo -e "  ${CYAN}API Requests:${NC}"
    echo -e "    ${GRAY}GET /api/setup/status (200) - Setup check${NC}"
    echo -e "    ${GRAY}POST /api/auth/login (200) - Login${NC}"
    echo -e "    ${GRAY}GET /api/payment-methods/enabled (200) - Payment methods${NC}"
    echo ""
    echo -e "  ${NC}Common Issues:${NC}"
    echo -e "    ${RED}404 on chunk files - Chunks not built or wrong paths${NC}"
    echo -e "    ${RED}401/403 on API calls - Authentication issues${NC}"
    echo -e "    ${RED}500 on API calls - Server errors (check API logs)${NC}"
    echo -e "    ${RED}CORS errors - API not accessible from browser${NC}"
    echo -e "    ${RED}Timeout errors - Server not responding${NC}"
fi

# ============================================
# 5. Production Deployment Checklist
# ============================================
print_section "Production Deployment Checklist"

declare -a checklist=(
    "Build completed successfully (npm run build)"
    "All chunks generated in dist/assets/"
    "Docker image built successfully"
    "Docker containers started (docker-compose up -d)"
    "API server responding (check http://localhost:3000/health)"
    "Web server responding (check http://localhost:5000)"
    "No errors in Docker logs (docker-compose logs)"
    "Browser console has no errors (F12)"
    "Network tab shows all assets loaded"
    "Login page appears (not white screen)"
    "Can login successfully"
    "Dashboard loads"
    "Can navigate to different pages"
    "Refund functionality works"
    "Split payment modal works"
)

echo ""
for item in "${checklist[@]}"; do
    echo -e "  ${GRAY}[ ] ✓ $item${NC}"
done

# ============================================
# 6. Quick Diagnosis Commands
# ============================================
print_section "Quick Diagnosis Commands"

echo ""
echo -e "  ${NC}Test local preview:${NC}"
echo -e "    ${CYAN}cd packages/web${NC}"
echo -e "    ${CYAN}npm run preview${NC}"
echo -e "    ${GRAY}# Open http://localhost:4173${NC}"
echo ""
echo -e "  ${NC}Check Docker containers:${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml ps${NC}"
echo ""
echo -e "  ${NC}View web logs:${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml logs -f web${NC}"
echo ""
echo -e "  ${NC}View API logs:${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml logs -f api${NC}"
echo ""
echo -e "  ${NC}Rebuild and restart:${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml down${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml build --no-cache web${NC}"
echo -e "    ${CYAN}docker-compose -f docker-compose.prod.yml up -d${NC}"
echo ""
echo -e "  ${NC}Check bundle in browser DevTools:${NC}"
echo -e "    ${GRAY}1. Open F12 Developer Tools${NC}"
echo -e "    ${GRAY}2. Go to Sources tab${NC}"
echo -e "    ${GRAY}3. Look for assets/vendor-react-*.js${NC}"
echo -e "    ${GRAY}4. Check if React exists in the bundle${NC}"
echo ""

# ============================================
# 7. Current Git State
# ============================================
print_section "Current Git State"

cd "$PROJECT_ROOT"

echo ""
echo -e "  ${NC}Current branch:${NC}"
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo -e "    ${CYAN}$BRANCH${NC}"

echo ""
echo -e "  ${NC}Recent commits:${NC}"
git log --oneline -5 2>/dev/null | while read -r line; do
    echo -e "    ${GRAY}$line${NC}"
done

echo ""
echo -e "  ${NC}Modified files:${NC}"
STATUS=$(git status --porcelain 2>/dev/null)
if [ -z "$STATUS" ]; then
    echo -e "    ${GREEN}No modifications${NC}"
else
    echo "$STATUS" | while read -r line; do
        echo -e "    ${YELLOW}$line${NC}"
    done
fi

echo ""
print_header "Investigation Complete"

echo -e "${NC}For more help, run with specific flags:${NC}"
echo -e "  ${GRAY}$0 --build${NC}"
echo -e "  ${GRAY}$0 --docker${NC}"
echo -e "  ${GRAY}$0 --browser${NC}"
echo -e "  ${GRAY}$0 --all${NC}"
echo ""
