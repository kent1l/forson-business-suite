# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package files for better cache utilization
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY . .

# Run tests and build
RUN npm run test && npm run build

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

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built assets from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Set user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# The app binds to port 3001
EXPOSE 3001

# Set Node.js to production mode
ENV NODE_ENV=production

# Command to run the application
CMD ["node", "dist/index.js"]
