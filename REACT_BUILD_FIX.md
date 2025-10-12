# Production Build Fix - Multiple Issues Resolved

## Problems Identified

### Issue 1: White Screen in Production (React Error)
The production deployment was showing a white screen with the following error:
```
Uncaught TypeError: Cannot set properties of undefined (setting 'Children')
```

**Root Cause:**
1. **Multiple React instances**: The production build was loading multiple copies of React due to inconsistent dependency resolution
2. **No package-lock.json**: The Dockerfile was using `npm install --no-package-lock`, which allowed different versions of dependencies to be installed
3. **Missing React deduplication**: Vite wasn't configured to deduplicate React modules during the build process

### Issue 2: Docker Build Failure (Rollup Native Binary)
Both local and GitHub Actions builds were failing with:
```
Error: Cannot find module @rollup/rollup-linux-x64-musl
```

**Root Cause:**
1. **npm optional dependencies bug**: Known npm bug with optional dependencies (https://github.com/npm/cli/issues/4828)
2. **Alpine Linux (musl)**: Requires specific native binaries for Rollup and LightningCSS
3. **Install order**: The optional dependencies were being installed then removed during workspace install

## Solutions Applied

### Fix 1: React Deduplication (White Screen Issue)

**1. Updated `packages/web/Dockerfile`:**
- Changed from `npm install --no-package-lock` to using workspace-aware installation
- Now respects the root `package-lock.json` if it exists
- Ensures consistent dependency versions across builds

**2. Updated `packages/web/vite.config.js`:**
- Added explicit React deduplication: `dedupe: ['react', 'react-dom']`
- Grouped both `react` and `react-dom` in the same vendor chunk
- Added `commonjsOptions` for better module resolution

**3. Workspace Configuration:**
- Root `package.json` already has React 18.3.1 with overrides
- This ensures all workspace packages use the same React version

### Fix 2: Alpine Native Binaries (Build Failure)

**Updated `packages/web/Dockerfile`:**
- Copy source code before installing optional dependencies
- Explicitly install Alpine musl binaries in the web package directory
- Install `@rollup/rollup-linux-x64-musl` and `lightningcss-linux-x64-musl` after main dependencies
- Use `--save-optional --no-package-lock` to prevent npm from removing them

## Deployment Instructions

### Step 1: Rebuild the Docker Image
```bash
# On your remote machine, pull the latest changes
git pull origin master

# Rebuild the frontend image with the fix
docker-compose -f docker-compose.prod.yml build frontend

# Or use the specific tag
docker build -t kentonel/forson-frontend:latest -f packages/web/Dockerfile .
```

### Step 2: Restart the Stack
```bash
# Stop the current containers
docker-compose -f docker-compose.prod.yml down frontend

# Start with the new image
docker-compose -f docker-compose.prod.yml up -d frontend

# Verify the container started successfully
docker-compose -f docker-compose.prod.yml logs -f frontend
```

### Step 3: Clear Browser Cache
After redeploying, users should:
1. Hard refresh the browser (Ctrl+F5 or Cmd+Shift+R)
2. Or clear browser cache
3. The new build will have different asset hashes

## Verification

### Check Build Output
The new build should show consistent vendor chunks:
- `vendor-react-[hash].js` - Contains both React and ReactDOM
- No duplicate React modules

### Check Browser Console
- No "Cannot set properties of undefined" errors
- No React warnings about multiple instances

### Check Docker Logs
```bash
docker-compose -f docker-compose.prod.yml logs frontend
```
Should show successful nginx startup without errors.

## Technical Details

### Why This Happened
In a monorepo/workspace setup:
1. Dependencies are hoisted to the root `node_modules`
2. If the Dockerfile doesn't respect this structure, it can install different versions
3. When multiple React versions exist, they conflict because React uses module-level state
4. The "Children" property error occurs when different React instances try to share internals

### The Fix
1. **Workspace awareness**: Install dependencies from the root, respecting the workspace structure
2. **Deduplication**: Tell Vite to ensure only one React instance exists in the final bundle
3. **Deterministic builds**: Use package-lock.json to ensure consistent dependency versions

## Rollback Plan (If Needed)

If issues persist, you can rollback to the previous image:
```bash
# Find previous image
docker images | grep forson-frontend

# Tag and use previous version
docker tag kentonel/forson-frontend:previous-tag kentonel/forson-frontend:latest
docker-compose -f docker-compose.prod.yml up -d frontend
```

## Future Prevention

1. **Always test production builds locally** before deploying:
   ```bash
   npm run build --workspace packages/web
   cd packages/web/dist
   python -m http.server 8080
   ```

2. **Monitor bundle sizes**: The production build output shows chunk sizes - watch for duplicate vendors

3. **Use lock files**: Commit `package-lock.json` to ensure consistent builds

## Related Files Modified

- `packages/web/Dockerfile` - Fixed dependency installation
- `packages/web/vite.config.js` - Added React deduplication
- Root `package.json` - Already had React overrides (no change needed)
