# GitHub Actions Build Fix

## Problem
The GitHub Actions builds were failing with the following error:
```
Error: Cannot find module @rollup/rollup-linux-x64-musl
```

This occurred in both the `Build and Push Docker Images` and `Deploy` workflows when building the frontend Docker image.

## Root Cause
The issue was caused by:
1. **Alpine Linux** (used in `node:20-alpine`) uses `musl` libc instead of `glibc`
2. **Rollup** (used by Vite) requires native bindings for the specific platform
3. **npm ci** in Alpine sometimes fails to properly install optional dependencies like `@rollup/rollup-linux-x64-musl`
4. Missing build tools (python, make, g++) needed to compile native modules

## Solution
Modified `packages/web/Dockerfile` to:

1. **Install build dependencies** before npm install:
   ```dockerfile
   RUN apk add --no-cache python3 make g++
   ```

2. **Use `npm install` instead of `npm ci`**:
   - `npm ci` is stricter and can fail with optional dependencies in Alpine
   - `npm install` is more forgiving and handles optional native dependencies better
   - Added `--include=optional` flag to ensure optional dependencies are installed

## Changes Made
- **File**: `packages/web/Dockerfile`
- **Change**: Added build tools installation and switched from `npm ci` to `npm install --include=optional`

## Impact
- ✅ Fixes failing builds in GitHub Actions
- ✅ Works in both Docker Hub and GitHub Container Registry workflows
- ✅ Maintains reproducible builds (package-lock.json is still used)
- ⚠️ Build time may increase slightly due to additional package installations

## Testing
To test locally:
```powershell
# Build the Docker image
docker build -f packages/web/Dockerfile -t forson-frontend:test .

# Or use docker-compose
docker-compose -f docker-compose.dev.yml build web
```

## Alternative Solutions Considered
1. **Use debian-based image** instead of Alpine - Rejected due to larger image size
2. **Pre-build with `npm rebuild`** - More complex and unnecessary with current fix
3. **Manually install rollup binding** - Less maintainable

## Notes
- The build tools (python3, make, g++) are only installed in the builder stage and not in the final image
- Final image size remains small as it only contains the built static files
- This fix is compatible with both local development and CI/CD pipelines
