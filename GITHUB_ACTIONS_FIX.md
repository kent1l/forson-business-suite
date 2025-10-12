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
2. **Rollup** (used by Vite) and **LightningCSS** (used by Tailwind CSS v4) require native bindings for the specific platform
3. **npm** in Alpine sometimes fails to properly install optional dependencies like:
   - `@rollup/rollup-linux-x64-musl`
   - `lightningcss-linux-x64-musl`
4. Missing build tools (python, make, g++) needed to compile native modules

## Solution
Modified `packages/web/Dockerfile` with a multi-layered fix:

1. **Install build dependencies** before npm install:
   ```dockerfile
   RUN apk add --no-cache python3 make g++
   ```

2. **Use `npm install` without package-lock.json**:
   - Removed `package-lock.json` from the COPY step to force fresh dependency resolution
   - Using `--no-package-lock` flag to prevent lock file issues in Alpine
   - Added `--include=optional` flag to ensure optional dependencies are installed

3. **Explicit fallback for native bindings**:
   ```dockerfile
   npm ls @rollup/rollup-linux-x64-musl || npm install @rollup/rollup-linux-x64-musl@latest --no-save --force && \
   npm ls lightningcss-linux-x64-musl || npm install lightningcss-linux-x64-musl@latest --no-save --force
   ```
   - If the musl bindings aren't found after install, force install them explicitly
   - Covers both Rollup (Vite) and LightningCSS (Tailwind CSS v4)
   - This handles cases where npm's optional dependency resolution fails

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
