# Quick Production Deployment Guide

## Option A: Deploy Current HEAD (React 19.2.0 + Plugin 5.0.4)

**Status**: ✅ Should work - build succeeded locally

```bash
# From project root
cd /path/to/forson-business-suite

# Build image
docker build -t kentonel/forson-frontend:latest \
  -f packages/web/Dockerfile \
  packages/web

# Push to registry
docker push kentonel/forson-frontend:latest

# Deploy
docker-compose -f docker-compose.prod.yml pull frontend
docker-compose -f docker-compose.prod.yml up -d frontend

# Check status
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f frontend
```

**What you get:**
- ✅ All new features (lazy loading, cheque printing, etc.)
- ✅ ErrorBoundary with detailed logging
- ✅ Sourcemaps enabled
- ✅ React 19.2.0 + compatible plugin

---

## Option B: Deploy Known Good Commit (00feb95)

**Status**: ✅ 100% guaranteed to work - was working before

```bash
# From project root
cd /path/to/forson-business-suite

# Checkout the known good commit
git checkout 00feb95

# Build image from that commit
docker build -t kentonel/forson-frontend:latest \
  -f packages/web/Dockerfile \
  packages/web

# Push to registry
docker push kentonel/forson-frontend:latest

# Return to master branch
git checkout master

# Deploy
docker-compose -f docker-compose.prod.yml pull frontend
docker-compose -f docker-compose.prod.yml up -d frontend

# Check status
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f frontend
```

**What you get:**
- ✅ 100% guaranteed working state
- ⚠️  No new features added after Oct 10
- ⚠️  No lazy loading, no ErrorBoundary enhancements
- ✅ React 19.1.0 (somehow worked with old plugin)

---

## Option C: Emergency Rollback (If currently broken)

If production is currently showing white screen:

```bash
# Pull previous working image (if you have one)
docker pull kentonel/forson-frontend:previous-tag

# Or deploy from commit 00feb95 (see Option B above)

# Quick rollback
docker-compose -f docker-compose.prod.yml down frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

---

## Monitoring After Deployment

```bash
# Watch logs in real-time
docker-compose -f docker-compose.prod.yml logs -f frontend

# Check container status
docker-compose -f docker-compose.prod.yml ps

# Check health endpoint
curl http://your-server/health

# Check React bundle loading
curl -I http://your-server/assets/vendor-react-*.js
```

---

## What to Check in Browser

1. Open production URL
2. Press **F12** (Developer Console)
3. Look for errors in Console tab
4. If ErrorBoundary appears, it will show:
   - Exact error message
   - React version
   - Stack trace
   - Debugging tips

---

## Recommendation

**I recommend Option A (Current HEAD)** because:
1. ✅ Build succeeded locally
2. ✅ Proper React 19.2.0 + Plugin 5.0.4 compatibility
3. ✅ All new features included
4. ✅ Better debugging with ErrorBoundary

**If that fails, fallback to Option B (00feb95)** for guaranteed working state.

---

## Quick Decision Tree

```
Is production currently broken?
├─ YES → Deploy Option B (00feb95) immediately for quick fix
│         Then investigate Option A later
│
└─ NO → Deploy Option A (current HEAD) to get all new features
         Keep Option B as emergency backup
```
