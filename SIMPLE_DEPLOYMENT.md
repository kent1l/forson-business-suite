# Simple Production Deployment Guide

## Overview

The production deployment has been simplified to closely mirror the development setup, with only essential production-specific features added (Nginx, health checks, logging).

---

## Quick Start

### On Production Server

```bash
# 1. Navigate to project directory
cd ~/projects/forson-business-suite

# 2. Pull latest code
git pull origin master

# 3. Build the frontend image
sudo docker compose -f docker-compose.prod.yml build web

# 4. Deploy
sudo docker compose -f docker-compose.prod.yml up -d

# 5. Verify
sudo docker compose -f docker-compose.prod.yml ps
curl http://localhost:8090
```

---

## What Changed (Simplified Approach)

### Before (Complex)
- ❌ Workspace root build context
- ❌ Complex npm ci with workspace handling  
- ❌ Manual user management
- ❌ Security update steps
- ❌ Volume mounts for configuration
- ❌ Over-engineered Dockerfile (70+ lines)

### Now (Simple)
- ✅ Package-level build context (`./packages/web`)
- ✅ Simple `npm install` → `npm run build`
- ✅ Minimal Dockerfile (25 lines)
- ✅ Same structure as development
- ✅ Still production-ready (multi-stage, Nginx, health checks)

---

## Dockerfile Structure

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK CMD wget --spider http://localhost/health || exit 1
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Key Points**:
- Same dependency installation as development
- Builds from package directory (not workspace root)
- Two stages: Node builder → Nginx server
- Health check included
- Clean and simple

---

## Docker Compose Structure

### Development
```yaml
frontend:
  build:
    context: ./packages/web
    dockerfile: Dockerfile.dev
  command: npm run dev
  volumes:
    - ./packages/web:/app  # Live code
  ports:
    - "5173:5173"
```

### Production
```yaml
frontend:
  build:
    context: ./packages/web  # Same context!
    dockerfile: Dockerfile
  ports:
    - "8090:80"
  healthcheck:
    test: ["CMD", "wget", "--spider", "http://localhost/health"]
  logging:
    driver: json-file
    options:
      max-size: "10m"
```

**Differences**:
- ✅ Same build context
- ✅ Production uses full Dockerfile (dev uses Dockerfile.dev)
- ✅ Production adds: health checks, log rotation, Nginx
- ✅ That's it!

---

## Build Process

### Local Testing
```bash
# From project root
cd packages/web
npm install
npm run build

# Check dist/ folder
ls -lh dist/assets/vendor-react*.js
```

### Docker Build
```bash
# Build production image
docker compose -f docker-compose.prod.yml build web

# Run locally for testing
docker compose -f docker-compose.prod.yml up web

# Access at http://localhost:8090
```

---

## Troubleshooting

### Build Fails
```bash
# Check if local build works
cd packages/web
npm install
npm run build

# If local works but Docker fails, check Docker logs
docker compose -f docker-compose.prod.yml build --no-cache web
```

### Old Assets Cached
```bash
# Hard refresh browser (Ctrl+F5)
# Or check what's in the container
docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/
```

### Health Check Failing
```bash
# Check Nginx logs
docker logs forson_frontend

# Verify nginx.conf is correct
docker exec forson_frontend cat /etc/nginx/conf.d/default.conf

# Test health endpoint manually
docker exec forson_frontend wget --spider http://localhost/health
```

---

## Deployment Workflow

### Standard Deployment
```bash
cd ~/projects/forson-business-suite
git pull origin master
sudo docker compose -f docker-compose.prod.yml build web
sudo docker compose -f docker-compose.prod.yml up -d
```

### Zero-Downtime Deployment (if needed)
```bash
# Build new image
sudo docker compose -f docker-compose.prod.yml build web

# Start new container with different name
sudo docker run -d --name forson_frontend_new \
  --network forson_network \
  -p 8091:80 \
  kentonel/forson-frontend:latest

# Test new container
curl http://localhost:8091

# Switch traffic (update nginx/load balancer)
# Then stop old container
sudo docker stop forson_frontend
sudo docker rm forson_frontend

# Rename new container
sudo docker rename forson_frontend_new forson_frontend
```

---

## Verification Checklist

After deployment:

- [ ] Containers are running: `docker compose ps`
- [ ] Frontend accessible: `curl http://localhost:8090`
- [ ] No errors in logs: `docker logs forson_frontend`
- [ ] Health check passing: `docker inspect forson_frontend | grep -A5 Health`
- [ ] React bundle loaded: Check browser network tab for `vendor-react-*.js`
- [ ] No console errors: Open browser DevTools

---

## Rollback

If deployment fails:

```bash
# Option 1: Use previous image tag
export TAG=previous-working-version
sudo docker compose -f docker-compose.prod.yml up -d

# Option 2: Revert code and rebuild
git revert HEAD
sudo docker compose -f docker-compose.prod.yml build web
sudo docker compose -f docker-compose.prod.yml up -d
```

---

## Maintenance

### View Logs
```bash
# Real-time logs
docker logs -f forson_frontend

# Last 100 lines
docker logs --tail 100 forson_frontend

# Logs from specific time
docker logs --since 10m forson_frontend
```

### Clean Up Old Images
```bash
# Remove dangling images
docker image prune

# Remove old frontend images
docker images | grep forson-frontend
docker rmi <old-image-id>
```

### Restart Single Service
```bash
sudo docker compose -f docker-compose.prod.yml restart frontend
```

---

## Environment Variables

Required in `.env` file:
```bash
# Database
DB_PASSWORD=your_secure_password
DB_USER=postgres
DB_NAME=forson_business_suite

# Meilisearch
MEILISEARCH_MASTER_KEY=your_secure_key

# Optional: Image versioning
TAG=v1.0.0
DOCKER_REGISTRY=kentonel
```

---

## Comparison: Dev vs Prod

| Feature | Development | Production |
|---------|-------------|------------|
| **Build Context** | `./packages/web` | `./packages/web` ✅ Same |
| **Dependencies** | `npm install` | `npm install` ✅ Same |
| **Build Command** | `npm run dev` | `npm run build` |
| **Web Server** | Vite dev server | Nginx |
| **Port** | 5173 | 80 (exposed as 8090) |
| **Source Code** | Bind-mounted | Baked into image |
| **Hot Reload** | Yes | No |
| **Health Checks** | No | Yes |
| **Log Rotation** | No | Yes |
| **Image Size** | ~200MB | ~50MB (multi-stage) |

---

## Key Takeaways

1. **Simplicity**: Production is just dev + Nginx + optimized build
2. **Same Dependencies**: Both use same `npm install` → no version conflicts
3. **Easy Debugging**: If dev works, prod should work (same build process)
4. **Minimal Differences**: Only production-essential features added
5. **No Over-Engineering**: Removed unnecessary complexity

---

## Next Steps

1. Pull latest code: `git pull origin master`
2. Build: `docker compose -f docker-compose.prod.yml build web`
3. Deploy: `docker compose -f docker-compose.prod.yml up -d`
4. Verify: Check logs and access http://localhost:8090

The white screen error should now be resolved with the simplified approach + updated @vitejs/plugin-react v5.0.4.

---

**Last Updated**: October 2025  
**Approach**: Simplified, aligned with development
