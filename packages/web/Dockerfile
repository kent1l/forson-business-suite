# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /workspace

# Install build dependencies needed for native modules
RUN apk add --no-cache python3 make g++

# Copy workspace root package files first (critical for workspace setup)
COPY package*.json ./

# Copy web package files
COPY packages/web/package*.json ./packages/web/

# Install dependencies using workspace structure
# Use ci if package-lock exists, otherwise install with exact versions
RUN if [ -f package-lock.json ]; then \
        npm ci --include=optional; \
    else \
        npm install --include=optional; \
    fi && \
    npm ls @rollup/rollup-linux-x64-musl || npm install @rollup/rollup-linux-x64-musl@latest --no-save --force && \
    npm ls lightningcss-linux-x64-musl || npm install lightningcss-linux-x64-musl@latest --no-save --force

# Copy web source code
COPY packages/web ./packages/web/

# Build the web application with workspace context
RUN npm run build --workspace packages/web

# Production stage
FROM nginx:stable-alpine

# Install security updates (best effort to avoid build failures on mirror hiccups)
RUN apk update --no-cache || true && \
    apk upgrade --no-cache || true

# Create non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Copy built files from builder
COPY --from=builder /workspace/packages/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

# Set correct permissions
RUN chown -R appuser:appgroup /usr/share/nginx/html && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    chown -R appuser:appgroup /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R appuser:appgroup /var/run/nginx.pid

# Run as root so Nginx can bind to port 80 inside the container
USER root

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]