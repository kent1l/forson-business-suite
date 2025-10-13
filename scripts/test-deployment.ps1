# Test Deployment Script for White Screen Fix
# This script helps verify the fix works before production deployment

param(
    [switch]$BuildOnly,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deployment Test Script" -ForegroundColor Cyan
Write-Host "  Testing White Screen Fix" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to print section headers
function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ">>> $Title" -ForegroundColor Yellow
    Write-Host "-----------------------------------" -ForegroundColor Gray
}

# Function to check step result
function Test-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host "  [TEST] $Name..." -NoNewline
    try {
        & $Action
        Write-Host " ✓ PASS" -ForegroundColor Green
        return $true
    } catch {
        Write-Host " ✗ FAIL" -ForegroundColor Red
        Write-Host "    Error: $_" -ForegroundColor Red
        return $false
    }
}

# Track test results
$testResults = @{
    Passed = 0
    Failed = 0
    Total = 0
}

function Record-TestResult {
    param([bool]$Passed)
    $testResults.Total++
    if ($Passed) {
        $testResults.Passed++
    } else {
        $testResults.Failed++
    }
}

# ============================================
# 1. Pre-Flight Checks
# ============================================
Write-Section "Pre-Flight Checks"

$result = Test-Step "Node.js is installed" {
    $nodeVersion = node --version
    if (-not $nodeVersion) { throw "Node.js not found" }
    Write-Host "    Node version: $nodeVersion" -ForegroundColor Gray
}
Record-TestResult $result

$result = Test-Step "npm is installed" {
    $npmVersion = npm --version
    if (-not $npmVersion) { throw "npm not found" }
    Write-Host "    npm version: $npmVersion" -ForegroundColor Gray
}
Record-TestResult $result

$result = Test-Step "Docker is running" {
    docker info | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Docker is not running" }
}
Record-TestResult $result

$result = Test-Step "Git repository is clean" {
    $status = git status --porcelain
    if ($Verbose -and $status) {
        Write-Host "    Modified files:" -ForegroundColor Gray
        $status | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
    }
}
Record-TestResult $result

# ============================================
# 2. Verify Critical Files
# ============================================
Write-Section "Verifying Critical Files"

$result = Test-Step "MainLayout.jsx has React import" {
    $content = Get-Content "$projectRoot\packages\web\src\components\layout\MainLayout.jsx" -Raw
    if ($content -notmatch "import React") {
        throw "MainLayout.jsx missing React import"
    }
    if ($content -match "React\.lazy\(") {
        throw "MainLayout.jsx still has lazy loading (should be reverted)"
    }
}
Record-TestResult $result

$result = Test-Step "RefundForm.jsx has React import" {
    $content = Get-Content "$projectRoot\packages\web\src\components\refunds\RefundForm.jsx" -Raw
    if ($content -notmatch "import React") {
        throw "RefundForm.jsx missing React import"
    }
}
Record-TestResult $result

$result = Test-Step "SplitPaymentModal.jsx has React import" {
    $content = Get-Content "$projectRoot\packages\web\src\components\ui\SplitPaymentModal.jsx" -Raw
    if ($content -notmatch "import React") {
        throw "SplitPaymentModal.jsx missing React import"
    }
}
Record-TestResult $result

$result = Test-Step "PurchaseOrderPage.jsx has direct import" {
    $content = Get-Content "$projectRoot\packages\web\src\pages\PurchaseOrderPage.jsx" -Raw
    if ($content -match "lazy\(\(\) => import") {
        throw "PurchaseOrderPage.jsx still has lazy loading (should be reverted)"
    }
}
Record-TestResult $result

$result = Test-Step "Package.json has correct React version" {
    $packageJson = Get-Content "$projectRoot\packages\web\package.json" | ConvertFrom-Json
    $reactVersion = $packageJson.dependencies.react
    $pluginVersion = $packageJson.devDependencies.'@vitejs/plugin-react'
    
    Write-Host "    React: $reactVersion" -ForegroundColor Gray
    Write-Host "    Plugin: $pluginVersion" -ForegroundColor Gray
    
    # Check if versions are compatible
    if ($reactVersion -match "19\.2\." -and $pluginVersion -match "5\.0\.") {
        # Compatible versions
    } else {
        Write-Host "    Warning: Versions may not be optimal" -ForegroundColor Yellow
    }
}
Record-TestResult $result

# ============================================
# 3. Build Test
# ============================================
Write-Section "Testing Build Process"

Write-Host "  [TEST] Cleaning previous build..." -NoNewline
Push-Location "$projectRoot\packages\web"
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}
Write-Host " ✓ DONE" -ForegroundColor Green

Write-Host "  [TEST] Running npm build..." -NoNewline
$buildStart = Get-Date
$buildOutput = npm run build 2>&1
$buildEnd = Get-Date
$buildTime = ($buildEnd - $buildStart).TotalSeconds

if ($LASTEXITCODE -eq 0) {
    Write-Host " ✓ PASS" -ForegroundColor Green
    Write-Host "    Build time: $([math]::Round($buildTime, 2))s" -ForegroundColor Gray
    Record-TestResult $true
} else {
    Write-Host " ✗ FAIL" -ForegroundColor Red
    Write-Host "Build output:" -ForegroundColor Red
    Write-Host $buildOutput -ForegroundColor Red
    Record-TestResult $false
    Pop-Location
    throw "Build failed"
}

# ============================================
# 4. Build Output Verification
# ============================================
Write-Section "Verifying Build Output"

$result = Test-Step "dist directory exists" {
    if (-not (Test-Path "dist")) { throw "dist directory not found" }
}
Record-TestResult $result

$result = Test-Step "index.html exists" {
    if (-not (Test-Path "dist\index.html")) { throw "index.html not found" }
}
Record-TestResult $result

$result = Test-Step "Vendor React bundle exists" {
    $reactBundle = Get-ChildItem "dist\assets" | Where-Object { $_.Name -like "vendor-react-*.js" }
    if (-not $reactBundle) { throw "React vendor bundle not found" }
    $sizeKB = [math]::Round($reactBundle.Length / 1KB, 2)
    Write-Host "    Size: $sizeKB KB" -ForegroundColor Gray
    if ($sizeKB -lt 300 -or $sizeKB -gt 500) {
        Write-Host "    Warning: Unexpected bundle size" -ForegroundColor Yellow
    }
}
Record-TestResult $result

$result = Test-Step "Main bundle exists" {
    $mainBundle = Get-ChildItem "dist\assets" | Where-Object { $_.Name -like "index-*.js" }
    if (-not $mainBundle) { throw "Main bundle not found" }
    $sizeKB = [math]::Round($mainBundle.Length / 1KB, 2)
    Write-Host "    Size: $sizeKB KB" -ForegroundColor Gray
}
Record-TestResult $result

$result = Test-Step "CSS bundle exists" {
    $cssBundle = Get-ChildItem "dist\assets" | Where-Object { $_.Name -like "index-*.css" }
    if (-not $cssBundle) { throw "CSS bundle not found" }
}
Record-TestResult $result

$result = Test-Step "Checking for lazy-loaded chunks" {
    $jsFiles = Get-ChildItem "dist\assets" -Filter "*.js"
    Write-Host "    Total JS files: $($jsFiles.Count)" -ForegroundColor Gray
    
    # Should have main bundle + vendors + report chunks (not page chunks)
    $pageChunks = $jsFiles | Where-Object { 
        $_.Name -notlike "vendor-*" -and 
        $_.Name -notlike "index-*" -and
        $_.Name -notlike "*Report*"
    }
    
    if ($pageChunks.Count -gt 0) {
        Write-Host "    Found page chunks (unexpected):" -ForegroundColor Yellow
        $pageChunks | ForEach-Object { Write-Host "      $($_.Name)" -ForegroundColor Yellow }
    }
}
Record-TestResult $result

# ============================================
# 5. Bundle Content Analysis
# ============================================
Write-Section "Analyzing Bundle Content"

$result = Test-Step "Checking React in main bundle" {
    $mainBundle = Get-ChildItem "dist\assets" | Where-Object { $_.Name -like "index-*.js" } | Select-Object -First 1
    $content = Get-Content $mainBundle.FullName -Raw
    
    # Should NOT have multiple React instances
    if ($content -match "react.*react" -and $content -match "createElement.*createElement") {
        Write-Host "    Warning: Possible duplicate React" -ForegroundColor Yellow
    }
}
Record-TestResult $result

$result = Test-Step "index.html references correct bundles" {
    $html = Get-Content "dist\index.html" -Raw
    
    if ($html -notmatch 'vendor-react-[a-zA-Z0-9_-]+\.js') {
        throw "index.html doesn't reference React vendor bundle"
    }
    if ($html -notmatch 'index-[a-zA-Z0-9_-]+\.js') {
        throw "index.html doesn't reference main bundle"
    }
    if ($html -notmatch 'index-[a-zA-Z0-9_-]+\.css') {
        throw "index.html doesn't reference CSS bundle"
    }
}
Record-TestResult $result

Pop-Location

# ============================================
# 6. Docker Build Test (if not BuildOnly)
# ============================================
if (-not $BuildOnly) {
    Write-Section "Testing Docker Build"
    
    Push-Location $projectRoot
    
    Write-Host "  [TEST] Building Docker image..." -NoNewline
    $dockerBuildStart = Get-Date
    $dockerOutput = docker-compose -f docker-compose.prod.yml build web 2>&1
    $dockerBuildEnd = Get-Date
    $dockerBuildTime = ($dockerBuildEnd - $dockerBuildStart).TotalSeconds
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✓ PASS" -ForegroundColor Green
        Write-Host "    Docker build time: $([math]::Round($dockerBuildTime, 2))s" -ForegroundColor Gray
        Record-TestResult $true
    } else {
        Write-Host " ✗ FAIL" -ForegroundColor Red
        if ($Verbose) {
            Write-Host "Docker output:" -ForegroundColor Red
            Write-Host $dockerOutput -ForegroundColor Red
        }
        Record-TestResult $false
    }
    
    $result = Test-Step "Docker image exists" {
        $images = docker images | Select-String "forson.*web"
        if (-not $images) { throw "Docker image not found" }
        Write-Host "    Image: $images" -ForegroundColor Gray
    }
    Record-TestResult $result
    
    Pop-Location
}

# ============================================
# 7. Summary
# ============================================
Write-Section "Test Summary"

Write-Host ""
Write-Host "  Total Tests: $($testResults.Total)" -ForegroundColor Cyan
Write-Host "  Passed:      $($testResults.Passed)" -ForegroundColor Green
Write-Host "  Failed:      $($testResults.Failed)" -ForegroundColor Red
Write-Host ""

if ($testResults.Failed -eq 0) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ✓ ALL TESTS PASSED!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Test in local preview mode:" -ForegroundColor White
    Write-Host "     cd packages\web" -ForegroundColor Gray
    Write-Host "     npm run preview" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. Deploy to staging:" -ForegroundColor White
    Write-Host "     docker-compose -f docker-compose.prod.yml up -d" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  3. Check for errors:" -ForegroundColor White
    Write-Host "     - Open browser to http://localhost:5000" -ForegroundColor Gray
    Write-Host "     - Check browser console (F12)" -ForegroundColor Gray
    Write-Host "     - Check Docker logs: docker-compose logs -f web" -ForegroundColor Gray
    Write-Host ""
    exit 0
} else {
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  ✗ SOME TESTS FAILED" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please fix the failing tests before deploying." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
