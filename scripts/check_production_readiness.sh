#!/bin/bash
# Production Readiness Check Script
# Run this before deploying to production

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================="
echo "  Forson Business Suite"
echo "  Production Readiness Check"
echo "========================================="
echo ""

WARNINGS=0
ERRORS=0

# Function to print check result
check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

# Check 1: Environment file exists
echo "1. Checking environment configuration..."
if [ -f ".env" ]; then
    check_pass "Environment file (.env) exists"
    
    # Check for placeholder values
    if grep -q "CHANGE_THIS" .env; then
        check_fail "Found placeholder values in .env - please set real values"
    else
        check_pass "No placeholder values found in .env"
    fi
    
    # Check JWT_SECRET length
    JWT_LEN=$(grep "^JWT_SECRET=" .env | cut -d'=' -f2 | tr -d '\n' | wc -c)
    if [ "$JWT_LEN" -ge 32 ]; then
        check_pass "JWT_SECRET is adequately long (${JWT_LEN} chars)"
    else
        check_fail "JWT_SECRET is too short (${JWT_LEN} chars, minimum 32 recommended)"
    fi
    
    # Check required variables
    REQUIRED_VARS=("DB_PASSWORD" "JWT_SECRET" "MEILISEARCH_MASTER_KEY")
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${var}=.\+" .env && ! grep -q "^${var}=$" .env; then
            check_pass "$var is set"
        else
            check_fail "$var is not set or empty"
        fi
    done
else
    check_fail "No .env file found - copy .env.production.example to .env"
fi

echo ""

# Check 2: Docker availability
echo "2. Checking Docker..."
if command -v docker &> /dev/null; then
    check_pass "Docker is installed"
    
    if docker ps &> /dev/null; then
        check_pass "Docker daemon is running"
    else
        check_fail "Docker daemon is not running or permission denied"
    fi
    
    # Check Docker Compose
    if docker compose version &> /dev/null; then
        check_pass "Docker Compose is available"
    else
        check_fail "Docker Compose is not available"
    fi
else
    check_fail "Docker is not installed"
fi

echo ""

# Check 3: Required files
echo "3. Checking required files..."
REQUIRED_FILES=(
    "docker-compose.prod.yml"
    "database/initial_schema.sql"
    "backup/backup.sh"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "$file exists"
    else
        check_fail "$file is missing"
    fi
done

# Check migrations directory
if [ -d "database/migrations" ]; then
    MIGRATION_COUNT=$(ls database/migrations/*.sql 2>/dev/null | wc -l)
    check_pass "Migrations directory exists with $MIGRATION_COUNT migration(s)"
else
    check_warn "Migrations directory not found"
fi

echo ""

# Check 4: Port availability
echo "4. Checking port availability..."
REQUIRED_PORTS=(5432 3001 7700 8090)
for port in "${REQUIRED_PORTS[@]}"; do
    if command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            check_warn "Port $port is already in use"
        else
            check_pass "Port $port is available"
        fi
    elif command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            check_warn "Port $port is already in use"
        else
            check_pass "Port $port is available"
        fi
    else
        check_warn "Cannot check port $port (netstat/ss not available)"
    fi
done

echo ""

# Check 5: Disk space
echo "5. Checking disk space..."
AVAILABLE_GB=$(df -BG . | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_GB" -ge 10 ]; then
    check_pass "Sufficient disk space (${AVAILABLE_GB}GB available)"
else
    check_warn "Low disk space (${AVAILABLE_GB}GB available, 10GB+ recommended)"
fi

echo ""

# Check 6: SSL Configuration (optional)
echo "6. Checking SSL configuration..."
if [ -d "nginx/ssl" ] && [ -f "nginx/ssl/fullchain.pem" ] && [ -f "nginx/ssl/privkey.pem" ]; then
    check_pass "SSL certificates found"
else
    check_warn "SSL certificates not found (nginx/ssl/ directory) - HTTPS will not work"
fi

echo ""

# Check 7: Backup directory
echo "7. Checking backup configuration..."
if [ -f "backup/backup.sh" ]; then
    check_pass "Backup script exists"
    if [ -x "backup/backup.sh" ]; then
        check_pass "Backup script is executable"
    else
        check_warn "Backup script is not executable - will be fixed by container"
    fi
else
    check_fail "Backup script is missing"
fi

echo ""
echo "========================================="
echo "  Summary"
echo "========================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready for production deployment.${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ ${WARNINGS} warning(s) found. Review before deploying.${NC}"
    exit 0
else
    echo -e "${RED}✗ ${ERRORS} error(s) and ${WARNINGS} warning(s) found.${NC}"
    echo -e "${RED}Please fix the errors before deploying to production.${NC}"
    exit 1
fi
