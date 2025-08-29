# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package files for better cache utilization
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:20-alpine

# Install PostgreSQL client and security updates
RUN apk update && \
    apk add --no-cache postgresql-client && \
    apk upgrade --no-cache

# Create non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Set working directory
WORKDIR /usr/src/app

# Copy node_modules and source from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app .

# Set user
USER appuser

# Health check (uses setup status endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/setup/status || exit 1

# The app binds to port 3001
EXPOSE 3001

# Set Node.js to production mode
ENV NODE_ENV=production

# Command to run the application
CMD ["node", "index.js"]

