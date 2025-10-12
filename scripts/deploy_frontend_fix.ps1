# React Build Fix - Deployment Script (PowerShell)
# This script rebuilds and redeploys the frontend with the React fix

$ErrorActionPreference = "Stop"

Write-Host "🔧 Forson Business Suite - Frontend Rebuild & Redeploy" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "docker-compose.prod.yml")) {
    Write-Host "❌ Error: docker-compose.prod.yml not found" -ForegroundColor Red
    Write-Host "Please run this script from the project root directory" -ForegroundColor Red
    exit 1
}

# Step 1: Pull latest changes (optional)
Write-Host "📥 Step 1: Pulling latest changes..." -ForegroundColor Yellow
try {
    git pull origin master
} catch {
    Write-Host "⚠️  Warning: Could not pull latest changes. Continuing anyway..." -ForegroundColor Yellow
}
Write-Host ""

# Step 2: Build the frontend image
Write-Host "🏗️  Step 2: Building frontend Docker image..." -ForegroundColor Yellow
Write-Host "This may take several minutes..." -ForegroundColor Gray
try {
    docker-compose -f docker-compose.prod.yml build frontend
    Write-Host "✅ Frontend image built successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Failed to build frontend image" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 3: Stop the current frontend container
Write-Host "🛑 Step 3: Stopping current frontend container..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml stop frontend
Write-Host "✅ Frontend container stopped" -ForegroundColor Green
Write-Host ""

# Step 4: Remove the old container
Write-Host "🗑️  Step 4: Removing old frontend container..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml rm -f frontend
Write-Host "✅ Old container removed" -ForegroundColor Green
Write-Host ""

# Step 5: Start the new frontend container
Write-Host "🚀 Step 5: Starting new frontend container..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml up -d frontend
Write-Host "✅ Frontend container started" -ForegroundColor Green
Write-Host ""

# Step 6: Wait for container to initialize
Write-Host "⏳ Waiting for container to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
Write-Host ""

# Step 7: Check container status
Write-Host "📊 Step 6: Checking container status..." -ForegroundColor Yellow
$containerStatus = docker-compose -f docker-compose.prod.yml ps | Select-String "forson_frontend.*Up"
if ($containerStatus) {
    Write-Host "✅ Frontend container is running" -ForegroundColor Green
} else {
    Write-Host "❌ Warning: Frontend container may not be running properly" -ForegroundColor Red
    Write-Host "Showing recent logs:" -ForegroundColor Yellow
    docker-compose -f docker-compose.prod.yml logs --tail=20 frontend
    exit 1
}
Write-Host ""

# Step 8: Show recent logs
Write-Host "📋 Step 7: Recent container logs:" -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml logs --tail=10 frontend
Write-Host ""

# Step 9: Test health endpoint
Write-Host "🏥 Step 8: Testing health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8090/health" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Health check passed" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Warning: Health check failed or not responding yet" -ForegroundColor Yellow
}
Write-Host ""

# Final instructions
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Open your browser and visit: http://YOUR_IP:8090"
Write-Host "2. Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)"
Write-Host "3. Check browser console for any errors"
Write-Host ""
Write-Host "To monitor logs:" -ForegroundColor Cyan
Write-Host "  docker-compose -f docker-compose.prod.yml logs -f frontend"
Write-Host ""
Write-Host "To check all services:" -ForegroundColor Cyan
Write-Host "  docker-compose -f docker-compose.prod.yml ps"
Write-Host "======================================================" -ForegroundColor Cyan
