# React Build Fix - Verification Checklist

## Pre-Deployment Verification

- [x] Local build successful (tested)
- [x] No duplicate React modules in vendor chunks
- [x] vite.config.js has React deduplication
- [x] Dockerfile respects workspace structure
- [x] All changes committed

## Deployment Steps

### On Remote Machine

1. **Navigate to project directory**
   ```bash
   cd /path/to/forson-business-suite
   ```

2. **Pull latest changes**
   ```bash
   git pull origin master
   ```

3. **Run deployment script** (Choose one)
   
   **Linux/Mac:**
   ```bash
   chmod +x scripts/deploy_frontend_fix.sh
   ./scripts/deploy_frontend_fix.sh
   ```
   
   **Windows:**
   ```powershell
   .\scripts\deploy_frontend_fix.ps1
   ```
   
   **Manual:**
   ```bash
   docker-compose -f docker-compose.prod.yml build frontend
   docker-compose -f docker-compose.prod.yml stop frontend
   docker-compose -f docker-compose.prod.yml rm -f frontend
   docker-compose -f docker-compose.prod.yml up -d frontend
   ```

## Post-Deployment Verification

### 1. Check Container Status
```bash
docker-compose -f docker-compose.prod.yml ps
```
**Expected:** `forson_frontend` should show "Up"

### 2. Check Container Logs
```bash
docker-compose -f docker-compose.prod.yml logs --tail=50 frontend
```
**Expected:** 
- No error messages
- Nginx started successfully
- No "cannot find module" errors

### 3. Check Health Endpoint
```bash
curl http://localhost:8090/health
# Or visit in browser: http://YOUR_IP:8090/health
```
**Expected:** HTTP 200 OK response

### 4. Test in Browser
1. Open browser: `http://YOUR_IP:8090`
2. Hard refresh: `Ctrl+F5` (Windows/Linux) or `Cmd+Shift+R` (Mac)
3. Open browser console (F12)

**Expected Results:**
- ✅ Page loads without white screen
- ✅ No "Cannot set properties of undefined" error
- ✅ No React warnings about multiple instances
- ✅ All components render correctly

**Expected Console Logs:**
```
Loading vendor-react-[NEW_HASH].js
Loading vendor-misc-[NEW_HASH].js
```
(Note: Hashes will be different from old deployment)

### 5. Check Asset Loading
In browser network tab (F12 → Network):

**Expected:**
- All JS/CSS files load with HTTP 200
- New asset hashes (different from before)
- No 404 errors

### 6. Test Core Functionality
Quick smoke test:
- [ ] Dashboard loads
- [ ] Can navigate between pages
- [ ] Forms work correctly
- [ ] Modal dialogs open/close
- [ ] API calls work (check network tab)

## Troubleshooting

### Issue: Container won't start
```bash
# Check detailed logs
docker-compose -f docker-compose.prod.yml logs frontend

# Check if port is already in use
netstat -tulpn | grep 8090  # Linux
netstat -ano | findstr :8090  # Windows

# Inspect container
docker inspect forson_frontend
```

### Issue: Still showing white screen
1. **Check browser cache:**
   - Clear browser cache completely
   - Try incognito/private window
   - Try different browser

2. **Verify assets are updated:**
   ```bash
   # Check if new build files exist
   docker exec forson_frontend ls -la /usr/share/nginx/html/assets/
   ```
   
   **Expected:** Files with new timestamps and hashes

3. **Check nginx config:**
   ```bash
   docker exec forson_frontend cat /etc/nginx/conf.d/default.conf
   docker exec forson_frontend nginx -t
   ```

### Issue: React error still appears
1. **Verify build used correct config:**
   ```bash
   # Rebuild without cache
   docker-compose -f docker-compose.prod.yml build --no-cache frontend
   docker-compose -f docker-compose.prod.yml up -d frontend
   ```

2. **Check for multiple React versions:**
   ```bash
   # Inside container
   docker exec forson_frontend find /usr/share/nginx/html -name "*.js" -type f -exec grep -l "React" {} \;
   ```

### Issue: API calls failing
```bash
# Check backend is running
docker-compose -f docker-compose.prod.yml ps backend

# Check backend logs
docker-compose -f docker-compose.prod.yml logs backend

# Test API directly
curl http://localhost:3001/health
```

## Rollback Procedure

If the fix doesn't work:

1. **Stop new container:**
   ```bash
   docker-compose -f docker-compose.prod.yml stop frontend
   ```

2. **Find previous image:**
   ```bash
   docker images | grep forson-frontend
   ```

3. **Revert to previous tag:**
   ```bash
   # Update docker-compose.prod.yml TAG variable or:
   docker tag kentonel/forson-frontend:PREVIOUS_TAG kentonel/forson-frontend:latest
   docker-compose -f docker-compose.prod.yml up -d frontend
   ```

4. **Report issue with:**
   - Full error messages
   - Browser console output
   - Container logs
   - Steps that were attempted

## Success Criteria

✅ **All of these should be true:**

1. Container is running and healthy
2. Web page loads (no white screen)
3. No React errors in browser console
4. Assets load with new hashes
5. Core functionality works
6. No 404 errors for resources
7. API calls work correctly

## Additional Notes

- **Cache:** Users may need to clear browser cache
- **Build time:** Frontend build takes 3-5 minutes
- **Downtime:** ~30 seconds during container restart
- **Logs:** Monitor for first 5 minutes after deployment

## Reference

- **Documentation:** See `REACT_BUILD_FIX.md` for technical details
- **Docker compose file:** `docker-compose.prod.yml`
- **Frontend Dockerfile:** `packages/web/Dockerfile`
- **Vite config:** `packages/web/vite.config.js`
