# Error Investigation Script
# This script helps diagnose white screen and production errors

param(
    [switch]$CheckBrowserConsole,
    [switch]$CheckDockerLogs,
    [switch]$CheckBuildOutput,
    [switch]$CheckNetworkRequests,
    [switch]$All
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Error Investigation Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Helper Functions
# ============================================
function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ">>> $Title" -ForegroundColor Yellow
    Write-Host "-----------------------------------" -ForegroundColor Gray
}

function Write-Finding {
    param([string]$Type, [string]$Message)
    $color = switch ($Type) {
        "ERROR" { "Red" }
        "WARNING" { "Yellow" }
        "INFO" { "Cyan" }
        "SUCCESS" { "Green" }
        default { "White" }
    }
    Write-Host "  [$Type] $Message" -ForegroundColor $color
}

# ============================================
# 1. Check Build Output for Errors
# ============================================
if ($CheckBuildOutput -or $All) {
    Write-Section "Checking Build Output"
    
    Push-Location "$projectRoot\packages\web"
    
    # Check if dist exists
    if (-not (Test-Path "dist")) {
        Write-Finding "ERROR" "dist directory doesn't exist. Build may have failed."
        Write-Host "    Run: npm run build" -ForegroundColor Gray
    } else {
        Write-Finding "SUCCESS" "dist directory exists"
        
        # List all generated files
        Write-Host ""
        Write-Host "  Generated files:" -ForegroundColor White
        Get-ChildItem "dist\assets" | ForEach-Object {
            $sizeKB = [math]::Round($_.Length / 1KB, 2)
            Write-Host "    $($_.Name) - $sizeKB KB" -ForegroundColor Gray
        }
        
        # Check for critical files
        Write-Host ""
        $reactBundle = Get-ChildItem "dist\assets" | Where-Object { $_.Name -like "vendor-react-*.js" }
        if ($reactBundle) {
            Write-Finding "SUCCESS" "React vendor bundle found: $($reactBundle.Name)"
            
            # Check for React duplication
            $content = Get-Content $reactBundle.FullName -Raw
            $reactCount = ([regex]::Matches($content, "(?i)react")).Count
            if ($reactCount -gt 100) {
                Write-Finding "WARNING" "React bundle is very large ($reactCount React references)"
                Write-Host "    This might indicate duplicate React instances" -ForegroundColor Yellow
            }
        } else {
            Write-Finding "ERROR" "React vendor bundle NOT found!"
        }
        
        # Check index.html
        $html = Get-Content "dist\index.html" -Raw
        Write-Host ""
        Write-Host "  index.html script references:" -ForegroundColor White
        $scriptMatches = [regex]::Matches($html, '<script[^>]+src="([^"]+)"')
        foreach ($match in $scriptMatches) {
            $src = $match.Groups[1].Value
            Write-Host "    - $src" -ForegroundColor Gray
        }
        
        # Check for missing chunks
        $missingChunks = [regex]::Matches($html, 'assets/([^"]+\.js)') | ForEach-Object {
            $fileName = $_.Groups[1].Value
            $fullPath = "dist\assets\$fileName"
            if (-not (Test-Path $fullPath)) {
                Write-Finding "ERROR" "Referenced file missing: $fileName"
            }
        }
    }
    
    Pop-Location
}

# ============================================
# 2. Check Docker Logs
# ============================================
if ($CheckDockerLogs -or $All) {
    Write-Section "Checking Docker Logs"
    
    Push-Location $projectRoot
    
    # Check if containers are running
    Write-Host "  Checking running containers..." -ForegroundColor White
    $containers = docker ps --filter "name=forson" --format "{{.Names}} - {{.Status}}"
    
    if (-not $containers) {
        Write-Finding "WARNING" "No Forson containers are running"
        Write-Host "    Start containers: docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor Gray
    } else {
        Write-Host ""
        $containers | ForEach-Object {
            Write-Host "    $_" -ForegroundColor Green
        }
        
        # Get web container logs
        Write-Host ""
        Write-Host "  Recent web container logs (last 50 lines):" -ForegroundColor White
        Write-Host ""
        docker-compose -f docker-compose.prod.yml logs --tail=50 web
        
        # Check for common error patterns
        Write-Host ""
        Write-Host "  Checking for common errors..." -ForegroundColor White
        $logs = docker-compose -f docker-compose.prod.yml logs web 2>&1 | Out-String
        
        if ($logs -match "error|Error|ERROR") {
            Write-Finding "ERROR" "Found error messages in logs"
            $errorLines = $logs -split "`n" | Where-Object { $_ -match "error|Error|ERROR" } | Select-Object -First 10
            $errorLines | ForEach-Object {
                Write-Host "    $_" -ForegroundColor Red
            }
        }
        
        if ($logs -match "ENOENT|Cannot find module") {
            Write-Finding "ERROR" "Missing module errors detected"
        }
        
        if ($logs -match "ECONNREFUSED") {
            Write-Finding "ERROR" "Connection refused errors detected"
        }
        
        if ($logs -match "webpack|bundle|chunk") {
            Write-Finding "WARNING" "Build/bundle related messages found"
        }
    }
    
    Pop-Location
}

# ============================================
# 3. Browser Console Errors Guide
# ============================================
if ($CheckBrowserConsole -or $All) {
    Write-Section "Browser Console Error Checklist"
    
    Write-Host "  To check browser console errors:" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. Open your application in browser" -ForegroundColor Gray
    Write-Host "     Development: http://localhost:5173" -ForegroundColor Gray
    Write-Host "     Production:  http://localhost:5000 (or your server)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. Open Developer Tools (F12 or Ctrl+Shift+I)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  3. Check Console tab for errors" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Common errors to look for:" -ForegroundColor White
    Write-Host ""
    
    $commonErrors = @(
        @{Pattern = "Cannot set properties of undefined"; Meaning = "React import missing or module not loaded"; Fix = "Check React imports in components"},
        @{Pattern = "Cannot read property 'map' of undefined"; Meaning = "API response not validated"; Fix = "Add defensive checks: response.data || []"},
        @{Pattern = "Failed to fetch"; Meaning = "Network/API request failed"; Fix = "Check API server is running and accessible"},
        @{Pattern = "Uncaught SyntaxError"; Meaning = "JavaScript parsing error"; Fix = "Check bundle integrity, rebuild"},
        @{Pattern = "Loading chunk .* failed"; Meaning = "Lazy-loaded chunk not found"; Fix = "Verify all chunks built, check paths"},
        @{Pattern = "React is not defined"; Meaning = "React not in scope"; Fix = "Add 'import React' to component"},
        @{Pattern = "undefined is not a function"; Meaning = "Function/method doesn't exist"; Fix = "Check import statements and exports"},
        @{Pattern = "Hydration error"; Meaning = "SSR/client mismatch"; Fix = "Check for server/client differences"}
    )
    
    $commonErrors | ForEach-Object {
        Write-Host "  Error Pattern: " -NoNewline -ForegroundColor Yellow
        Write-Host $_.Pattern -ForegroundColor Red
        Write-Host "    Meaning: $($_.Meaning)" -ForegroundColor Gray
        Write-Host "    Fix: $($_.Fix)" -ForegroundColor Cyan
        Write-Host ""
    }
    
    Write-Host "  4. Check Network tab" -ForegroundColor Gray
    Write-Host "     - Look for failed requests (red)" -ForegroundColor Gray
    Write-Host "     - Check for 404 errors on chunk files" -ForegroundColor Gray
    Write-Host "     - Verify all assets loaded successfully" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  5. If white screen with no console errors:" -ForegroundColor Gray
    Write-Host "     - Check if main bundle loaded (Network tab)" -ForegroundColor Gray
    Write-Host "     - Check if React initialized (React DevTools)" -ForegroundColor Gray
    Write-Host "     - Check Docker/server logs for startup errors" -ForegroundColor Gray
}

# ============================================
# 4. Network Request Patterns
# ============================================
if ($CheckNetworkRequests -or $All) {
    Write-Section "Network Request Patterns to Check"
    
    Write-Host "  Expected requests in Network tab:" -ForegroundColor White
    Write-Host ""
    Write-Host "  Initial Page Load:" -ForegroundColor Cyan
    Write-Host "    GET / (200) - Should return index.html" -ForegroundColor Gray
    Write-Host "    GET /assets/index-*.css (200) - Main stylesheet" -ForegroundColor Gray
    Write-Host "    GET /assets/vendor-react-*.js (200) - React vendor bundle" -ForegroundColor Gray
    Write-Host "    GET /assets/vendor-misc-*.js (200) - Other vendors" -ForegroundColor Gray
    Write-Host "    GET /assets/index-*.js (200) - Main app bundle" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  API Requests:" -ForegroundColor Cyan
    Write-Host "    GET /api/setup/status (200) - Setup check" -ForegroundColor Gray
    Write-Host "    POST /api/auth/login (200) - Login" -ForegroundColor Gray
    Write-Host "    GET /api/payment-methods/enabled (200) - Payment methods" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Common Issues:" -ForegroundColor Yellow
    Write-Host "    404 on chunk files - Chunks not built or wrong paths" -ForegroundColor Red
    Write-Host "    401/403 on API calls - Authentication issues" -ForegroundColor Red
    Write-Host "    500 on API calls - Server errors (check API logs)" -ForegroundColor Red
    Write-Host "    CORS errors - API not accessible from browser" -ForegroundColor Red
    Write-Host "    Timeout errors - Server not responding" -ForegroundColor Red
}

# ============================================
# 5. Production Deployment Checklist
# ============================================
Write-Section "Production Deployment Checklist"

$checklist = @(
    "✓ Build completed successfully (npm run build)",
    "✓ All chunks generated in dist/assets/",
    "✓ Docker image built successfully",
    "✓ Docker containers started (docker-compose up -d)",
    "✓ API server responding (check http://localhost:3000/health)",
    "✓ Web server responding (check http://localhost:5000)",
    "✓ No errors in Docker logs (docker-compose logs)",
    "✓ Browser console has no errors (F12)",
    "✓ Network tab shows all assets loaded",
    "✓ Login page appears (not white screen)",
    "✓ Can login successfully",
    "✓ Dashboard loads",
    "✓ Can navigate to different pages",
    "✓ Refund functionality works",
    "✓ Split payment modal works"
)

Write-Host ""
$checklist | ForEach-Object {
    Write-Host "  [ ] $_" -ForegroundColor Gray
}

# ============================================
# 6. Quick Diagnosis Commands
# ============================================
Write-Section "Quick Diagnosis Commands"

Write-Host ""
Write-Host "  Test local preview:" -ForegroundColor White
Write-Host "    cd packages\web" -ForegroundColor Cyan
Write-Host "    npm run preview" -ForegroundColor Cyan
Write-Host "    # Open http://localhost:4173" -ForegroundColor Gray
Write-Host ""
Write-Host "  Check Docker containers:" -ForegroundColor White
Write-Host "    docker-compose -f docker-compose.prod.yml ps" -ForegroundColor Cyan
Write-Host ""
Write-Host "  View web logs:" -ForegroundColor White
Write-Host "    docker-compose -f docker-compose.prod.yml logs -f web" -ForegroundColor Cyan
Write-Host ""
Write-Host "  View API logs:" -ForegroundColor White
Write-Host "    docker-compose -f docker-compose.prod.yml logs -f api" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Rebuild and restart:" -ForegroundColor White
Write-Host "    docker-compose -f docker-compose.prod.yml down" -ForegroundColor Cyan
Write-Host "    docker-compose -f docker-compose.prod.yml build --no-cache web" -ForegroundColor Cyan
Write-Host "    docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Check bundle in browser DevTools:" -ForegroundColor White
Write-Host "    1. Open F12 Developer Tools" -ForegroundColor Gray
Write-Host "    2. Go to Sources tab" -ForegroundColor Gray
Write-Host "    3. Look for assets/vendor-react-*.js" -ForegroundColor Gray
Write-Host "    4. Check if React exists in the bundle" -ForegroundColor Gray
Write-Host ""

# ============================================
# 7. Current Git State
# ============================================
Write-Section "Current Git State"

Push-Location $projectRoot

Write-Host ""
Write-Host "  Current branch:" -ForegroundColor White
$branch = git branch --show-current
Write-Host "    $branch" -ForegroundColor Cyan

Write-Host ""
Write-Host "  Recent commits:" -ForegroundColor White
git log --oneline -5 | ForEach-Object {
    Write-Host "    $_" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Modified files:" -ForegroundColor White
$status = git status --porcelain
if ($status) {
    $status | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "    No modifications" -ForegroundColor Green
}

Pop-Location

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Investigation Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "For more help, run with specific flags:" -ForegroundColor White
Write-Host "  .\test-deployment.ps1 -CheckBuildOutput" -ForegroundColor Gray
Write-Host "  .\test-deployment.ps1 -CheckDockerLogs" -ForegroundColor Gray
Write-Host "  .\test-deployment.ps1 -CheckBrowserConsole" -ForegroundColor Gray
Write-Host "  .\test-deployment.ps1 -All" -ForegroundColor Gray
Write-Host ""
