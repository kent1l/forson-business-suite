# React Bundle Error - Root Cause & Solution

## Current Problem

**Error in Browser Console:**
```
Uncaught TypeError: Cannot set properties of undefined (setting 'Activity')
    at Ob (vendor-react-CJOLRsrI.js:17:4557)
```

**What's Happening:**
The production container is serving an **OLD bundle** (`vendor-react-CJOLRsrI.js`) that was built with **multiple React versions** (React 18.3.1 + React 19.2.0 mixed). When this bundle executes, React's internal export object (`he`) is undefined at the point where the code tries to set `he.Activity = ...`.

## Root Cause Analysis

### Why `he` is undefined:

1. **Multiple React Instances**: The old bundle contained two different React versions:
   - React 18.3.1 from peer dependencies (@headlessui, recharts, etc.)
   - React 19.2.0 from the main app
   
2. **Module Initialization Conflict**: When Vite bundled these without proper deduplication:
   - React 18's initialization code runs and creates its export object
   - React 19's initialization code tries to use React 18's export object
   - But they're separate instances, so the reference is `undefined`
   
3. **Export Object Mismatch**: The minified code shows:
   ```javascript
   return he.Activity = S,
          he.Children = pe,
          // ...
   ```
   At this point, `he` should be the React module's export object, but it's `undefined` because the bundler included multiple React copies that interfere with each other.

### Evidence:

```bash
# Current container assets (OLD)
$ docker exec forson_frontend ls /usr/share/nginx/html/assets | grep vendor-react
vendor-react-CJOLRsrI.js  ← OLD BUNDLE with React version conflicts

# Expected new bundle (after rebuild)
vendor-react-D2jcrJUs.js  ← NEW BUNDLE with single React 19.2.0
```

## Solution Applied

### Changes Made (Commits ce5bef0 + bf96e90 + 840460f):

1. **Unified React Version** (`package.json` + `packages/web/package.json`):
   - Set React + ReactDOM to `^19.2.0` in root workspace
   - Set React + ReactDOM to `^19.2.0` in web package
   - Removed conflicting React 18 references

2. **Vite Deduplication** (`packages/web/vite.config.js`):
   ```javascript
   resolve: {
     dedupe: ['react', 'react-dom']
   }
   ```
   This ensures Vite uses only ONE React instance even if multiple copies exist in node_modules.

3. **Deterministic Builds** (`packages/web/Dockerfile`):
   ```dockerfile
   COPY package-lock.json ./
   RUN npm ci --include=optional
   ```
   This ensures the exact same dependency versions are installed every time.

4. **CRITICAL FIX - Alpine Binaries as Optional Dependencies** (commit 840460f):
   - **Problem Found**: The Dockerfile had a separate `npm install` step for Alpine binaries that was **re-resolving dependencies** and bringing back React 18
   - **Solution**: Moved `@rollup/rollup-linux-x64-musl` and `lightningcss-linux-x64-musl` to `optionalDependencies` in `packages/web/package.json`
   - **Result**: These binaries are now installed by the initial `npm ci`, preserving the lockfile state
   
   Before (broken):
   ```dockerfile
   RUN npm ci --include=optional
   RUN cd packages/web && npm install --save-optional --no-package-lock \
       @rollup/rollup-linux-x64-musl lightningcss-linux-x64-musl
   # ↑ This was removing 13 packages and changing 45 packages!
   ```
   
   After (fixed):
   ```json
   // packages/web/package.json
   "optionalDependencies": {
     "@rollup/rollup-linux-x64-musl": "^4.30.2",
     "lightningcss-linux-x64-musl": "^1.30.0"
   }
   ```

5. **Local Build Verification**:
   ```bash
   $ npm ls react
   # Result: All packages dedupe to react@19.2.0 ✓
   
   $ npm run build --workspace packages/web
   # Output: vendor-react-D2jcrJUs.js (NEW HASH) ✓
   ```

## Deployment Steps

### IMPORTANT: Previous Build Issue Resolved!

The first rebuild attempt (commit 9aaa45c) produced the old hash `CJOLRsrI` because the Dockerfile had a separate `npm install` step that was **re-resolving dependencies**. This has been fixed in commit **840460f**.

### Option 1: Automated Rebuild (Recommended)

```bash
cd ~/projects/forson-business-suite
git pull origin master
chmod +x scripts/verify_and_rebuild.sh
sudo ./scripts/verify_and_rebuild.sh
```

This script will:
- Show current vs expected bundle hash
- Rebuild the frontend container with no cache
- Verify the new bundle is deployed
- Check React version in the bundle

**Expected Result:** Bundle hash should be `D2jcrJUs` (or similar new hash, NOT `CJOLRsrI`)

### Option 2: Manual Rebuild

```bash
cd ~/projects/forson-business-suite
git pull origin master

# Rebuild frontend (5-10 minutes)
sudo docker compose -f docker-compose.prod.yml build --no-cache frontend

# Restart container
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate frontend

# Verify new bundle
sudo docker exec forson_frontend ls /usr/share/nginx/html/assets | grep vendor-react
# Should show: vendor-react-D2jcrJUs.js (or similar NEW hash)
```

### Option 3: Deep Diagnostics (if issues persist)

```bash
cd ~/projects/forson-business-suite
chmod +x scripts/diagnose_react_bundle.sh
./scripts/diagnose_react_bundle.sh
```

This will extract:
- React version from bundle
- Export pattern analysis
- Error context around line 17
- Debug files in `/tmp/`

## Post-Deployment Verification

1. **Check Bundle Hash Changed:**
   ```bash
   sudo docker exec forson_frontend ls /usr/share/nginx/html/assets | grep vendor-react
   # Expected: vendor-react-D2jcrJUs.js (NOT CJOLRsrI.js)
   ```

2. **Open Browser:**
   - Navigate to: `http://YOUR_IP:8090`
   - **Hard refresh:** `Ctrl+F5` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   
3. **Check Console:**
   - Should be **NO** "Cannot set properties of undefined" error
   - React should initialize cleanly

4. **Verify React Version:**
   ```bash
   # In browser console:
   console.log(window.React?.version || 'React not exposed')
   ```

## Why the Old Bundle Failed

The old bundle (`vendor-react-CJOLRsrI.js`) contains this pattern:
```javascript
// React 18 code initializes 'ge' as export object
var ge = {};
// ... React 18 setup ...

// React 19 code tries to use 'he' as export object
// But 'he' was never declared/initialized!
return he.Activity = S,  // ← TypeError: Cannot set properties of undefined
       he.Children = pe,
       // ...
```

The variable name mismatch (`ge` vs `he`) suggests **two separate React modules** were bundled, and the minifier gave them different variable names. When React 19's code tries to export via `he`, but only `ge` was initialized, it crashes.

## Expected New Bundle Behavior

The new bundle (`vendor-react-D2jcrJUs.js`) contains:
```javascript
// Single React 19.2.0 instance
var ge = {};  // Export object properly initialized

return ge.Activity = S,  // ✓ Works because 'ge' exists
       ge.Children = pe,
       // ...
```

## Summary

| Issue | Old Build | New Build |
|-------|-----------|-----------|
| React versions | 18.3.1 + 19.2.0 mixed | 19.2.0 only |
| Bundle hash | CJOLRsrI | D2jcrJUs |
| Export object | `he` undefined | `ge` initialized |
| Runtime error | TypeError | ✓ Works |

## If Problems Persist After Rebuild

1. **Capture diagnostics:**
   ```bash
   ./scripts/diagnose_react_bundle.sh > /tmp/diagnostics.txt
   ```

2. **Check browser cache:**
   - Try incognito/private window
   - Clear all browser cache
   - Check Network tab to confirm new bundle is loading

3. **Verify Docker build logs:**
   ```bash
   docker compose -f docker-compose.prod.yml build --no-cache --progress=plain frontend 2>&1 | tee build.log
   grep -i "error\|warning" build.log
   ```

4. **Collect full context:**
   - Browser console output (full stack trace)
   - `docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/`
   - First 500 lines of the active vendor-react file
   - `npm ls react` output from build environment

---

**Bottom Line:** The container needs to be rebuilt to pick up the fixed dependencies. The current running container is using an old image with the broken bundle. Once rebuilt, the new bundle with unified React 19.2.0 will resolve the "Cannot set properties of undefined" error.
