# Production Deployment Guide

This guide walks you through deploying Forson Business Suite to a production environment from scratch.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Initial Deployment](#initial-deployment)
- [Database Initialization](#database-initialization)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Server Requirements
- **OS**: Ubuntu 22.04 LTS or similar Linux distribution
- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum, 8GB+ recommended
- **Storage**: 20GB+ free space (more for backups and growth)
- **Network**: Public IP address with ports 80/443 accessible

### Software Requirements
- Docker Engine 24.0+ ([Install Guide](https://docs.docker.com/engine/install/))
- Docker Compose 2.20+ (comes with Docker Desktop)
- Git 2.30+
- (Optional) Nginx for reverse proxy if not using built-in frontend nginx

### Domain & SSL
- A registered domain name pointing to your server IP
- SSL certificate (Let's Encrypt recommended, see [SSL Configuration](#ssltls-configuration))

---

## Server Setup

### 1. Prepare the Server

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y git curl wget ufw fail2ban

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

### 2. Clone the Repository

```bash
# Create application directory
sudo mkdir -p /opt/forson-business-suite
sudo chown $USER:$USER /opt/forson-business-suite
cd /opt/forson-business-suite

# Clone repository
git clone https://github.com/kent1l/forson-business-suite.git .

# Set permissions
chmod +x scripts/*.sh scripts/*.ps1
```

---

## Initial Deployment

### 1. Configure Environment Variables

```bash
# Copy production environment template
cp .env.production.example .env

# Edit with your production values
nano .env
```

**Required changes in `.env`:**
- `DB_PASSWORD`: Strong database password (min 16 chars, alphanumeric + symbols)
- `JWT_SECRET`: Generate with `openssl rand -base64 32`
- `MEILISEARCH_MASTER_KEY`: Generate with `openssl rand -base64 32`
- `DOCKER_REGISTRY`: Your registry if using custom images (optional)
- `TAG`: Image version tag (e.g., `v1.0.0`, default: `latest`)

### 2. Pull/Build Images

**Option A: Pull from Docker Hub** (recommended for production)
```bash
docker compose -f docker-compose.prod.yml pull
```

**Option B: Build locally** (for custom changes)
```bash
docker compose -f docker-compose.prod.yml build
```

### 3. Start Services

```bash
# Start all services in detached mode
docker compose -f docker-compose.prod.yml up -d

# Check service health
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

---

## Database Initialization

### Fresh Install (New Database)

For a brand new production deployment, initialize the database schema:

```bash
# Wait for database to be ready
docker exec forson_db pg_isready -U postgres -d forson_business_suite

# Run automated rebuild script (PowerShell - on Windows host)
pwsh ./scripts/rebuild_database.ps1

# OR manual initialization (Linux/Mac)
# Copy schema to container
docker cp ./database/initial_schema.sql forson_db:/tmp/initial_schema.sql

# Apply base schema
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/initial_schema.sql

# Apply migrations in order
for f in database/migrations/*.sql; do
    docker cp "$f" forson_db:/tmp/$(basename "$f")
    docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
done
```

### Migrating from Existing Database

If you have an existing backup:

```bash
# Copy backup to container
docker cp /path/to/backup.sql forson_db:/tmp/backup.sql

# Restore backup
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/backup.sql

# Verify restoration
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -c "\dt"
```

### Create Default Admin User

```bash
# Access backend container
docker exec -it forson_backend sh

# Run admin creation script (if available) or use API
# Example using curl from host:
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "ChangeThisPassword123!",
    "firstName": "Admin",
    "lastName": "User",
    "permissionLevelId": 10
  }'
```

---

## SSL/TLS Configuration

### Using Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt install -y certbot

# Stop nginx if running to free port 80
docker compose -f docker-compose.prod.yml stop frontend

# Obtain certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates to nginx directory
sudo mkdir -p ./nginx/ssl
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/

# Update nginx configuration
cat > ./nginx/conf.d/ssl.conf << 'EOF'
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
EOF

# Restart frontend with SSL
docker compose -f docker-compose.prod.yml up -d frontend

# Set up auto-renewal
sudo crontab -e
# Add: 0 0 * * 0 certbot renew --quiet && docker compose -f /opt/forson-business-suite/docker-compose.prod.yml restart frontend
```

---

## Monitoring & Maintenance

### Health Checks

```bash
# Check all container health status
docker compose -f docker-compose.prod.yml ps

# View resource usage
docker stats

# Check specific service logs
docker compose -f docker-compose.prod.yml logs backend --tail=100 -f
```

### Log Rotation

The production compose file includes log rotation (max 10MB per file, 3 files):

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

### Database Maintenance

```bash
# Run VACUUM to reclaim space
docker exec forson_db psql -U postgres -d forson_business_suite -c "VACUUM FULL ANALYZE;"

# Check database size
docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT pg_size_pretty(pg_database_size('forson_business_suite'));"

# Rebuild indexes (if needed)
docker exec forson_db psql -U postgres -d forson_business_suite -c "REINDEX DATABASE forson_business_suite;"
```

---

## Backup & Recovery

### Automated Backups

The backup container runs daily backups automatically (configurable via `BACKUP_INTERVAL_SECONDS`).

Backup location: `/var/lib/docker/volumes/forson_backup_data/_data/`

```bash
# List backups
docker exec forson_backup ls -lh /backups

# Copy backup to host
docker cp forson_backup:/backups/backup-YYYY-MM-DD.sql.gz ./backups/

# Verify backup integrity
gunzip -c ./backups/backup-YYYY-MM-DD.sql.gz | head -n 50
```

### Manual Backup

```bash
# Create immediate backup
docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite -F c -Z 9 > backup-$(date +%Y%m%d-%H%M%S).dump

# Create SQL backup
docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite > backup-$(date +%Y%m%d-%H%M%S).sql
gzip backup-*.sql
```

### Restore from Backup

```bash
# Stop application containers
docker compose -f docker-compose.prod.yml stop backend frontend

# Drop and recreate database
docker exec -u postgres forson_db psql -U postgres -c "DROP DATABASE IF EXISTS forson_business_suite;"
docker exec -u postgres forson_db psql -U postgres -c "CREATE DATABASE forson_business_suite OWNER postgres;"

# Restore from custom format
docker cp backup-YYYYMMDD-HHMMSS.dump forson_db:/tmp/restore.dump
docker exec -u postgres forson_db pg_restore -U postgres -d forson_business_suite -v /tmp/restore.dump

# OR restore from SQL
docker cp backup-YYYYMMDD-HHMMSS.sql forson_db:/tmp/restore.sql
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/restore.sql

# Restart application
docker compose -f docker-compose.prod.yml up -d backend frontend
```

### Off-Site Backup Strategy

```bash
# Rsync to remote server
rsync -avz --delete /var/lib/docker/volumes/forson_backup_data/_data/ user@backup-server:/backups/forson/

# Or use cloud storage (AWS S3 example)
aws s3 sync /var/lib/docker/volumes/forson_backup_data/_data/ s3://your-bucket/forson-backups/
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check container logs
docker compose -f docker-compose.prod.yml logs <service-name>

# Check if port is already in use
sudo netstat -tulpn | grep <port>

# Restart specific service
docker compose -f docker-compose.prod.yml restart <service-name>
```

### Database Connection Issues

```bash
# Verify database is running
docker exec forson_db pg_isready -U postgres

# Check database logs
docker logs forson_db --tail=100

# Test connection from backend
docker exec forson_backend sh -c 'nc -zv db 5432'
```

### Performance Issues

```bash
# Check container resource usage
docker stats

# Check database connections
docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds';"
```

### Backup Container Restarting

If the backup container continuously restarts:
- Check logs: `docker logs forson_backup`
- Verify backup script exists: `docker exec forson_backup ls -l /scripts/backup.sh`
- Check disk space: `df -h`
- Verify environment variables: `docker exec forson_backup env | grep DB_`

---

## Updating the Application

### Rolling Update (Zero Downtime)

```bash
# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Recreate containers with new images
docker compose -f docker-compose.prod.yml up -d --no-deps --build backend
docker compose -f docker-compose.prod.yml up -d --no-deps --build frontend

# Verify health
docker compose -f docker-compose.prod.yml ps
```

### Applying New Migrations

```bash
# Copy new migration files to container
for f in database/migrations/YYYYMMDD_*.sql; do
    docker cp "$f" forson_db:/tmp/$(basename "$f")
    docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
done

# Verify migration
docker exec forson_db psql -U postgres -d forson_business_suite -c "\dt"
```

---

## Security Checklist

- [ ] Strong passwords for DB_PASSWORD, JWT_SECRET, and MEILISEARCH_MASTER_KEY
- [ ] SSL/TLS enabled with valid certificate
- [ ] Firewall configured (UFW or iptables)
- [ ] Database not exposed to public internet (use internal Docker network)
- [ ] Regular automated backups tested and working
- [ ] Log monitoring and alerting configured
- [ ] Fail2ban configured to prevent brute force attacks
- [ ] Docker daemon secured (do not expose Docker socket publicly)
- [ ] Regular security updates applied (`apt update && apt upgrade`)
- [ ] Environment variables not committed to version control

---

## Support & Resources

- **Documentation**: [README.md](./README.md)
- **Issue Tracker**: [GitHub Issues](https://github.com/kent1l/forson-business-suite/issues)
- **Docker Docs**: [Docker Compose](https://docs.docker.com/compose/)
- **PostgreSQL Docs**: [PostgreSQL Documentation](https://www.postgresql.org/docs/)

For production support, please contact your system administrator or DevOps team.
