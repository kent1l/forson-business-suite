# White Screen Fix - React Sync External Store Compatibility

## Problem
The white screen error was caused by a compatibility issue between React 19.1.0 and `use-sync-external-store@1.6.0`, which is used by:
- `@headlessui/react@2.2.9`
- `recharts@3.2.1` (which uses `react-redux@9.2.0`)

The error manifested as:
```
react.production.js:25 Uncaught TypeError: i is not a function
at _b (react.production.js:25:10)
at Zu (index.js:4:20)
at requireWithSelector_production (with-selector.production.js:12:13)
```

## Solution
Downgraded `use-sync-external-store` to version 1.2.2 using npm overrides in the root `package.json`.

## Deployment Steps (On Server)

```bash
# 1. Navigate to project directory
cd ~/projects/forson-business-suite

# 2. Pull the latest changes
git pull origin master

# 3. Remove all node_modules and lock files
rm -rf node_modules packages/web/node_modules package-lock.json packages/web/package-lock.json

# 4. Install dependencies with the override
npm install

# 5. Verify the correct version is installed
npm list use-sync-external-store
# Should show: use-sync-external-store@1.2.2 overridden

# 6. Build the frontend
cd packages/web
npm run build

# 7. Verify new bundles were created
ls -lh dist/assets/vendor-react-*
# Should show new bundle with different hash

# 8. Rebuild Docker image
cd ~/projects/forson-business-suite
docker compose -f docker-compose.prod.yml build frontend

# 9. Redeploy frontend container
docker compose -f docker-compose.prod.yml stop frontend
docker compose -f docker-compose.prod.yml rm -f frontend
docker compose -f docker-compose.prod.yml up -d frontend

# 10. Verify container is running
docker compose -f docker-compose.prod.yml ps frontend

# 11. Check logs for errors
docker compose -f docker-compose.prod.yml logs frontend --tail 20
```

## Verification

1. Open browser and navigate to `http://YOUR_SERVER_IP:8090`
2. Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)
3. Check browser console - should see no errors
4. Application should load without white screen

## Technical Details

The fix works by:
1. Using npm's `overrides` feature to force all packages to use `use-sync-external-store@1.2.2`
2. This older version is compatible with React 19's built-in `useSyncExternalStore` implementation
3. Version 1.6.0 had breaking changes that conflicted with React 19

## Files Changed
- `package.json` - Added overrides section
- `package-lock.json` - Updated dependency resolution
- `packages/web/package-lock.json` - Updated dependency resolution

## Commit
```
7fc4239 - fix: downgrade use-sync-external-store to 1.2.2 for React 19 compatibility
```
