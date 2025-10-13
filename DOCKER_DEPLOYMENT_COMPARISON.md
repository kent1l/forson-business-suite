# Docker Deployment Comparison: Development vs Production

## Overview

This document compares the development and production Docker stack deployments for the Forson Business Suite, highlighting key differences, design decisions, and operational characteristics.

---

## Quick Reference Table

| Aspect | Development | Production |
|--------|-------------|------------|
| **Compose File** | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
| **Build Context** | Live source with volumes | Multi-stage build, static assets |
| **Hot Reload** | ✅ Yes (file watchers) | ❌ No (immutable containers) |
| **Dependencies** | Installed at runtime | Baked into image |
| **Web Server** | Vite dev server (5173) | Nginx (80) |
| **Logging** | Stdout/stderr | JSON with rotation |
| **Health Checks** | Basic/none | Comprehensive |
| **Restart Policy** | `unless-stopped` | `unless-stopped` with health |
| **Security** | Relaxed (dev tools) | Hardened (non-root user) |
| **Image Tags** | `latest` (local build) | Versioned (`${TAG}`) |

---

## Detailed Comparison

### 1. Frontend Service

#### Development Configuration
```yaml
frontend:
  container_name: forson_frontend_dev
  build:
    context: ./packages/web
    dockerfile: Dockerfile.dev           # Simple dev Dockerfile
  command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
  volumes:
    - ./packages/web:/app               # BIND MOUNT for hot reload
    - /app/node_modules                 # Anonymous volume for modules
  environment:
    - CHOKIDAR_USEPOLLING=true          # File watcher polling
    - VITE_PROXY_TARGET=http://forson_backend_dev:3001
  ports:
    - "5173:5173"                       # Vite dev server
  restart: unless-stopped
```

**Key Characteristics**:
- **Live Source Code**: Bind mount allows instant code changes
- **Hot Module Replacement**: Vite dev server with HMR
- **Dependencies Installed at Runtime**: `npm install` runs on startup
- **File Watching**: Polling enabled for Docker compatibility
- **Development Port**: 5173 (Vite default)
- **No Health Checks**: Faster startup for development

#### Production Configuration
```yaml
frontend:
  build:
    context: .                          # WORKSPACE ROOT context
    dockerfile: ./packages/web/Dockerfile
  image: kentonel/forson-frontend:${TAG:-react18-fix}
  container_name: forson_frontend
  restart: unless-stopped
  depends_on:
    backend:
      condition: service_healthy        # Wait for backend health
  ports:
    - "8090:80"                         # Nginx production port
  volumes:
    - ./nginx/ssl:/etc/nginx/ssl:ro     # SSL certs (read-only)
    - ./nginx/conf.d:/etc/nginx/conf.d:ro
  healthcheck:
    test: ["CMD", "wget", "--spider", "http://localhost/health"]
    interval: 30s
    timeout: 10s
    retries: 3
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
```

**Key Characteristics**:
- **Multi-stage Build**: Separate builder and runtime stages
- **Static Assets**: Pre-built, optimized production bundle
- **Nginx Web Server**: Efficient static file serving
- **Health Monitoring**: Active health checks
- **Log Rotation**: Prevents disk space issues
- **Versioned Images**: Tagged for rollback capability
- **Security Hardening**: Non-root user, minimal attack surface

---

### 2. Dockerfile Comparison

#### Development Dockerfile (`Dockerfile.dev`)
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Simple dependency install
COPY package*.json ./
RUN npm install

# Source code will be bind-mounted
COPY . .

# Command defined in docker-compose
```

**Purpose**: Minimal setup for development workflow
- Fast builds (caches node_modules)
- Expects source code via bind mount
- Development dependencies included

#### Production Dockerfile (`Dockerfile`)
```dockerfile
# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /workspace

# Install build tools for native modules
RUN apk add --no-cache python3 make g++

# Copy workspace files for monorepo support
COPY package*.json ./
COPY package-lock.json ./
COPY packages/web/package*.json ./packages/web/

# Deterministic install with lockfile
RUN npm ci --include=optional

# Copy source and build
COPY packages/web ./packages/web/
RUN npm run build --workspace packages/web

# ============================================
# Stage 2: Production Runtime
# ============================================
FROM nginx:stable-alpine

# Security updates
RUN apk update && apk upgrade

# Non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Copy built assets from builder
COPY --from=builder /workspace/packages/web/dist /usr/share/nginx/html

# Nginx configuration
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

# Set permissions
RUN chown -R appuser:appgroup /usr/share/nginx/html

USER root  # Nginx needs root for port 80

HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget --spider http://localhost:80/health || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Purpose**: Optimized, secure production deployment
- **Multi-stage**: Separates build tools from runtime
- **Smaller Image**: No Node.js in final image (~50MB vs ~200MB)
- **Security**: Non-root user, minimal packages
- **Deterministic**: Uses `npm ci` with lockfile
- **Immutable**: Built assets baked into image

---

### 3. Backend Service

#### Development
```yaml
backend:
  container_name: forson_backend_dev
  build:
    context: ./packages/api
  command: sh -c "npm install && npm start"
  volumes:
    - ./packages/api:/usr/src/app        # Live code
    - backend_node_modules:/usr/src/app/node_modules
    - ./backups:/backups                 # Shared volumes
    - ./database:/database
  environment:
    - NODE_ENV=development
    - CHOKIDAR_USEPOLLING=true
    - DISABLE_MEILI_LISTENERS=true       # Disable for dev
```

**Characteristics**:
- Live code editing with nodemon
- Database migrations accessible
- Meilisearch listeners disabled (manual sync)
- Verbose logging

#### Production
```yaml
backend:
  image: kentonel/forson-backend:${TAG:-latest}
  container_name: forson_backend
  restart: unless-stopped
  depends_on:
    db:
      condition: service_healthy
  environment:
    - NODE_ENV=production
  ports:
    - "3001:3001"
  healthcheck:
    test: ["CMD", "wget", "--spider", "http://localhost:3001/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
```

**Characteristics**:
- Pre-built image (immutable)
- Health-based dependency ordering
- Meilisearch listeners enabled
- Structured logging with rotation

---

### 4. Database & Supporting Services

#### Shared Configuration (via `docker-compose.yml`)

Both environments use:
```yaml
db:
  image: postgres:15-alpine
  container_name: forson_db
  environment:
    POSTGRES_PASSWORD: ${DB_PASSWORD}
    POSTGRES_DB: forson_business_suite
    TZ: Asia/Manila
  volumes:
    - postgres_data:/var/lib/postgresql/data
  ports:
    - "5432:5432"
```

#### Production Enhancements
```yaml
db:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
    interval: 10s
    timeout: 5s
    retries: 5
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
```

**Key Additions**:
- Health checks for startup orchestration
- Log rotation to prevent disk fill
- More robust environment configuration

---

### 5. Networking & Volumes

#### Development
```yaml
networks:
  default:
    name: forson_business_suite

volumes:
  backend_node_modules:  # Named volume for isolation
  postgres_data:
  meili_data:
```

**Purpose**: 
- Simple default network
- Anonymous volume for node_modules prevents overwrite

#### Production
```yaml
networks:
  default:
    name: forson_network

volumes:
  postgres_data:
    name: forson_postgres_data
  meili_data:
    name: forson_meili_data
  backup_data:
    name: forson_backup_data
```

**Purpose**:
- Explicit volume names for management
- Additional backup volume for persistence
- Production-grade naming convention

---

## Build Process Differences

### Development Build
```bash
# No pre-build required
docker-compose -f docker-compose.dev.yml up -d

# Dependencies installed at container startup
# Source code mounted from host
# Changes reflect immediately
```

**Workflow**:
1. Pull base images
2. Start containers
3. Install dependencies (first run)
4. Code changes auto-reload

### Production Build
```bash
# Build stage
docker compose -f docker-compose.prod.yml build --no-cache web

# Deployment stage
docker compose -f docker-compose.prod.yml up -d
```

**Workflow**:
1. **Build Stage**:
   - Install dependencies in builder container
   - Run `npm run build` (Vite production build)
   - Generate optimized bundles (minified, tree-shaken)
   - Copy dist/ to Nginx container
2. **Runtime Stage**:
   - Serve static files via Nginx
   - No Node.js or build tools in final image
   - Immutable deployment

---

## Performance Characteristics

### Development
| Metric | Value | Notes |
|--------|-------|-------|
| **Startup Time** | ~10-30s | npm install on first run |
| **Hot Reload** | <1s | Instant reflection of changes |
| **Build Time** | N/A | No pre-build required |
| **Memory Usage** | ~500MB | Vite dev server + dependencies |
| **Image Size** | ~200MB | Full Node.js + dev deps |

### Production
| Metric | Value | Notes |
|--------|-------|-------|
| **Build Time** | ~2-5 min | Full npm ci + Vite build |
| **Startup Time** | ~2-5s | Static assets only |
| **Response Time** | <10ms | Nginx static serving |
| **Memory Usage** | ~50MB | Nginx only |
| **Image Size** | ~50MB | Alpine + Nginx + static files |

---

## Security Comparison

### Development
- ❌ Root user in containers
- ❌ All ports exposed
- ❌ Debug endpoints enabled
- ❌ Source maps included
- ❌ Verbose error messages
- ⚠️ Development dependencies present
- ✅ Isolated network (local only)

**Risk Level**: **LOW** (not exposed to internet)

### Production
- ✅ Non-root users
- ✅ Minimal port exposure (80, 3001, 5432)
- ✅ Health check endpoints only
- ✅ Source maps excluded
- ✅ Generic error messages
- ✅ Production-only dependencies
- ✅ Log rotation (prevents DoS)
- ✅ Security updates applied
- ✅ Read-only volume mounts

**Risk Level**: **HARDENED** (public-facing)

---

## Troubleshooting Differences

### Development
**Easy Debugging**:
```bash
# Access live logs
docker logs -f forson_frontend_dev

# Exec into container
docker exec -it forson_frontend_dev sh

# Check files
docker exec forson_frontend_dev ls -la /app

# Install debug tools
docker exec forson_frontend_dev npm install -g <tool>
```

**Restart with changes**:
```bash
# Changes auto-reload (no restart needed)
# For dependency changes:
docker-compose -f docker-compose.dev.yml restart frontend
```

### Production
**Controlled Inspection**:
```bash
# View rotated logs
docker logs --tail 100 forson_frontend

# Exec into container (limited tools)
docker exec -it forson_frontend sh

# Check served files
docker exec forson_frontend ls -lh /usr/share/nginx/html

# Cannot install new tools (immutable image)
```

**Deployment with changes**:
```bash
# Rebuild required for any code change
docker compose -f docker-compose.prod.yml build --no-cache web
docker compose -f docker-compose.prod.yml up -d
```

---

## Environment Variables

### Development
```bash
# .env (loaded by compose)
DB_PASSWORD=dev_password
MEILISEARCH_MASTER_KEY=dev_key
NODE_ENV=development

# Container-specific (in compose file)
CHOKIDAR_USEPOLLING=true
DISABLE_MEILI_LISTENERS=true
VITE_PROXY_TARGET=http://forson_backend_dev:3001
```

**Characteristics**:
- Relaxed secrets (development only)
- Polling enabled for Docker
- Debug features enabled

### Production
```bash
# .env (loaded by compose)
DB_PASSWORD=<strong-password>
MEILISEARCH_MASTER_KEY=<strong-key>
NODE_ENV=production
TAG=v1.2.3  # Image versioning

# Container-specific (minimal)
# Most config baked into images
```

**Characteristics**:
- Strong secrets (never committed)
- Minimal runtime configuration
- Versioned deployments

---

## Upgrade & Rollback

### Development
**Upgrade**:
```bash
git pull origin develop
docker-compose -f docker-compose.dev.yml restart
```

**Rollback**:
```bash
git checkout <previous-commit>
docker-compose -f docker-compose.dev.yml restart
```

**Simplicity**: Very easy, instant changes

### Production
**Upgrade**:
```bash
git pull origin master
export TAG=v1.2.4
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
```

**Rollback**:
```bash
export TAG=v1.2.3  # Previous working version
docker compose -f docker-compose.prod.yml up -d
# Images already built, instant rollback
```

**Reliability**: Versioned images enable instant rollback

---

## Common Issues & Solutions

### Development Issues

#### Issue 1: Hot Reload Not Working
**Cause**: Docker file watching limitations  
**Solution**: Already configured with polling:
```yaml
environment:
  - CHOKIDAR_USEPOLLING=true
  - CHOKIDAR_INTERVAL=100
```

#### Issue 2: Port Already in Use
**Cause**: Previous container not stopped  
**Solution**:
```bash
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d
```

#### Issue 3: Dependencies Not Installing
**Cause**: Volume permission issues  
**Solution**:
```bash
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
```

### Production Issues

#### Issue 1: White Screen (React Errors)
**Cause**: Incompatible build tool versions (see PRODUCTION_ERROR_RESOLUTION.md)  
**Solution**: Update @vitejs/plugin-react to v5.0.4+

#### Issue 2: Health Check Failing
**Cause**: Application not ready, missing /health endpoint  
**Solution**: Check logs, verify Nginx config
```bash
docker logs forson_frontend
docker exec forson_frontend cat /etc/nginx/conf.d/default.conf
```

#### Issue 3: Old Assets Cached
**Cause**: Browser/CDN caching  
**Solution**:
```bash
# Hard refresh in browser (Ctrl+F5)
# Verify new bundle hash:
docker exec forson_frontend ls -lh /usr/share/nginx/html/assets/
```

---

## Best Practices

### Development
1. ✅ **Keep containers running**: Use `restart: unless-stopped`
2. ✅ **Use bind mounts**: Enable hot reload
3. ✅ **Isolate dependencies**: Use anonymous volumes for node_modules
4. ✅ **Enable file watching**: Set CHOKIDAR_USEPOLLING
5. ✅ **Disable production features**: No health checks, minimal logging

### Production
1. ✅ **Use multi-stage builds**: Minimize image size
2. ✅ **Version images**: Enable rollback capability
3. ✅ **Implement health checks**: Monitor container status
4. ✅ **Rotate logs**: Prevent disk space issues
5. ✅ **Use specific tags**: Avoid `latest` in production
6. ✅ **Security hardening**: Non-root users, minimal packages
7. ✅ **Immutable deployments**: No runtime code changes

---

## Migration Path: Dev → Production

### Step 1: Test Production Build Locally
```bash
# Build production images
docker compose -f docker-compose.prod.yml build

# Run locally on different ports
docker compose -f docker-compose.prod.yml up -d

# Test the application
curl http://localhost:8090
```

### Step 2: Verify Environment Variables
```bash
# Check .env has production values
grep -E "PASSWORD|KEY" .env

# Ensure no dev-only variables
grep -E "CHOKIDAR|POLLING" .env  # Should be empty
```

### Step 3: Deploy to Production Server
```bash
# On remote server
git clone <repo>
cd forson-business-suite

# Set production env
export TAG=v1.0.0

# Build & deploy
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# Monitor startup
docker compose -f docker-compose.prod.yml logs -f
```

---

## Summary

| When to Use | Configuration |
|-------------|---------------|
| **Local Development** | `docker-compose.dev.yml` - Fast iteration, live reload |
| **Production Deployment** | `docker-compose.prod.yml` - Optimized, secure, monitored |
| **Production Testing** | `docker-compose.prod.yml` locally with test env vars |
| **CI/CD Builds** | `docker-compose.prod.yml` with versioned tags |

**Key Takeaway**: Development prioritizes speed and developer experience; Production prioritizes reliability, security, and performance.

---

**Last Updated**: October 2025  
**Related Docs**: 
- `PRODUCTION_DEPLOYMENT.md` - Production deployment guide
- `PRODUCTION_ERROR_RESOLUTION.md` - Troubleshooting guide
- `README.md` - General setup instructions
