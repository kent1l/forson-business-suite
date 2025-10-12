# Production Deployment Quick Reference

## 🚀 Quick Start (Fresh Production Install)

### Prerequisites
- Docker & Docker Compose installed
- Domain name pointing to your server
- Ports 80, 443, 3001, 5432, 7700, 8090 available

### 1. Clone & Configure

```bash
# Clone repository
git clone https://github.com/kent1l/forson-business-suite.git
cd forson-business-suite

# Create production environment file
cp .env.production.example .env

# Edit with your values (IMPORTANT: Change all passwords and secrets!)
nano .env
```

### 2. Generate Secure Secrets

```bash
# Generate JWT secret
openssl rand -base64 32

# Generate Meilisearch key
openssl rand -base64 32

# Generate strong database password (32 chars, alphanumeric + symbols)
openssl rand -base64 24
```

Add these to your `.env` file.

### 3. Run Production Readiness Check

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run readiness check
./scripts/check_production_readiness.sh
```

Fix any errors before proceeding.

### 4. Deploy

#### Automated Deployment
```bash
./scripts/deploy_production.sh
```

#### Manual Deployment
```bash
# Pull images
docker compose -f docker-compose.prod.yml pull

# Start services
docker compose -f docker-compose.prod.yml up -d

# Initialize database (fresh install only)
docker cp ./database/initial_schema.sql forson_db:/tmp/initial_schema.sql
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/initial_schema.sql

# Apply migrations
for f in database/migrations/*.sql; do
    docker cp "$f" forson_db:/tmp/$(basename "$f")
    docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
done
```

### 5. Verify Deployment

```bash
# Check service status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Test health endpoints
curl http://localhost:3001/health
curl http://localhost:8090/health
```

### 6. Create Admin User

```bash
# Via API (replace with your values)
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "SecurePassword123!",
    "firstName": "Admin",
    "lastName": "User",
    "permissionLevelId": 10
  }'
```

---

## 🔐 Security Checklist

Before going live, ensure:

- [ ] All default passwords changed in `.env`
- [ ] JWT_SECRET is at least 32 random characters
- [ ] MEILISEARCH_MASTER_KEY is strong and random
- [ ] DB_PASSWORD is strong (16+ chars, mixed)
- [ ] SSL/TLS configured with valid certificate
- [ ] Firewall configured (only ports 80/443 exposed publicly)
- [ ] Database not exposed to internet (use internal network)
- [ ] Backups tested and verified
- [ ] `.env` file has restricted permissions (`chmod 600 .env`)
- [ ] `.env` is in `.gitignore` (never commit secrets!)

---

## 📊 Monitoring

### View Service Status
```bash
docker compose -f docker-compose.prod.yml ps
```

### View Logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs backend -f --tail=100
```

### Resource Usage
```bash
docker stats
```

### Database Size
```bash
docker exec forson_db psql -U postgres -d forson_business_suite -c \
  "SELECT pg_size_pretty(pg_database_size('forson_business_suite'));"
```

---

## 💾 Backup & Recovery

### Verify Automated Backups
```bash
# List backups
docker exec forson_backup ls -lh /backups

# Copy backup to host
docker cp forson_backup:/backups/backup-YYYY-MM-DD.sql.gz ./backups/
```

### Manual Backup
```bash
# Create backup
docker exec -u postgres forson_db pg_dump -U postgres \
  -d forson_business_suite -F c -Z 9 > backup-$(date +%Y%m%d-%H%M%S).dump

# Verify backup
ls -lh backup-*.dump
```

### Restore from Backup
```bash
# Stop application
docker compose -f docker-compose.prod.yml stop backend frontend

# Drop and recreate database
docker exec -u postgres forson_db psql -U postgres -c \
  "DROP DATABASE IF EXISTS forson_business_suite;"
docker exec -u postgres forson_db psql -U postgres -c \
  "CREATE DATABASE forson_business_suite OWNER postgres;"

# Restore
docker cp backup-YYYYMMDD-HHMMSS.dump forson_db:/tmp/restore.dump
docker exec -u postgres forson_db pg_restore -U postgres \
  -d forson_business_suite -v /tmp/restore.dump

# Restart application
docker compose -f docker-compose.prod.yml up -d backend frontend
```

---

## 🔄 Updates & Maintenance

### Update Application
```bash
# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Recreate containers
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps
```

### Apply New Migrations
```bash
# Copy and apply new migration
docker cp database/migrations/YYYYMMDD_new_migration.sql forson_db:/tmp/migration.sql
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/migration.sql
```

### Database Maintenance
```bash
# VACUUM (reclaim space)
docker exec forson_db psql -U postgres -d forson_business_suite -c "VACUUM FULL ANALYZE;"

# Reindex
docker exec forson_db psql -U postgres -d forson_business_suite -c "REINDEX DATABASE forson_business_suite;"
```

---

## 🆘 Troubleshooting

### Services Won't Start
```bash
# Check logs
docker compose -f docker-compose.prod.yml logs

# Check specific service
docker logs forson_backend

# Restart service
docker compose -f docker-compose.prod.yml restart backend
```

### Database Connection Failed
```bash
# Check if database is running
docker exec forson_db pg_isready -U postgres

# Check database logs
docker logs forson_db

# Test connection from backend
docker exec forson_backend sh -c 'nc -zv db 5432'
```

### Out of Disk Space
```bash
# Check disk usage
df -h

# Remove old Docker images
docker system prune -a

# Check backup size
du -sh /var/lib/docker/volumes/forson_backup_data/_data/
```

### Backup Container Keeps Restarting
```bash
# Check backup logs
docker logs forson_backup

# Verify backup script
docker exec forson_backup cat /scripts/backup.sh

# Check environment variables
docker exec forson_backup env | grep DB_
```

---

## 📚 Documentation

- **Full Production Guide**: [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)
- **General Documentation**: [README.md](./README.md)
- **Copilot Instructions**: [.github/copilot-instructions.md](./.github/copilot-instructions.md)

---

## 🔗 Service URLs

After deployment:
- **Frontend**: http://your-domain.com:8090 (or port 80/443 with SSL)
- **Backend API**: http://your-domain.com:3001
- **Meilisearch**: http://your-domain.com:7700 (internal only)
- **Database**: localhost:5432 (internal only)

**Note**: Secure these ports appropriately. Only 80/443 should be publicly accessible.

---

## 📞 Support

For issues or questions:
1. Check [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) for detailed troubleshooting
2. Review Docker logs: `docker compose -f docker-compose.prod.yml logs`
3. Open an issue: [GitHub Issues](https://github.com/kent1l/forson-business-suite/issues)
