# Forson Business Suite - Commands

Simple, copy-paste-ready commands for development and production. Descriptions are outside the code blocks. Commands include sudo where appropriate.

**📚 See also:**
- [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) - Full deployment checklist
- [PRODUCTION_QUICKSTART.md](./PRODUCTION_QUICKSTART.md) - Quick reference guide
- [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md) - Complete deployment guide

---

## 1) One-Time Setup

### Development Environment
Create a working .env from the example file.
```bash
cp .env.example .env
```

### Production Environment
Create production .env from the production template.
```bash
cp .env.production.example .env
# Edit .env and set all required values (DB_PASSWORD, JWT_SECRET, MEILISEARCH_MASTER_KEY)
```

Generate secure secrets for production.
```bash
# JWT Secret (use in .env as JWT_SECRET)
openssl rand -base64 32

# Meilisearch Key (use in .env as MEILISEARCH_MASTER_KEY)
openssl rand -base64 32

# Database Password (use in .env as DB_PASSWORD)
openssl rand -base64 24
```

---

## 2) Development

Start dev stack with hot reload.
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Initialize the database (first run only).
```bash
docker cp ./database/initial_schema.sql forson_db:/initial_schema.sql
docker exec -u postgres forson_db psql -d forson_business_suite -f /initial_schema.sql
```

Apply migrations.
```bash
npm --prefix packages/api run migrate -- --host localhost
```

Open logs for backend.
```bash
docker compose logs -f backend
```

Stop and remove dev containers.
```bash
docker compose down
```

---

## 3) Production - Fresh Install

### Option A: Automated Deployment (Recommended)

Check production readiness.
```bash
chmod +x scripts/*.sh
./scripts/check_production_readiness.sh
```

Run automated deployment.
```bash
./scripts/deploy_production.sh
```

### Option B: Manual Step-by-Step

Pull Docker images.
```bash
sudo docker compose -f docker-compose.prod.yml pull
```

Start production stack.
```bash
sudo docker compose -f docker-compose.prod.yml up -d
```

Initialize database using automated script (PowerShell - Windows/WSL).
```powershell
pwsh ./scripts/rebuild_database.ps1
```

OR Initialize database manually (Linux/Mac).
```bash
# Wait for database
sudo docker exec forson_db pg_isready -U postgres -d forson_business_suite

# Apply schema
sudo docker cp ./database/initial_schema.sql forson_db:/tmp/initial_schema.sql
sudo docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/initial_schema.sql

# Apply migrations
for f in $(ls database/migrations/*.sql | sort); do 
    sudo docker cp "$f" forson_db:/tmp/$(basename "$f")
    sudo docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
done
```

Verify deployment.
```bash
sudo docker compose -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.prod.yml logs --tail=100
```

---

## 4) Production - Updates & Maintenance

### Backup Database (Before Any Update)

Create timestamped backup.
```bash
mkdir -p backups
ts=$(date +"%Y-%m-%dT%H-%M-%S")
sudo docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite -F c -Z 9 > backups/backup-$ts.dump
```

### Update Application

Pull latest code.
```bash
git pull --ff-only
```

Pull latest Docker images.
```bash
sudo docker compose -f docker-compose.prod.yml pull
```

Restart services with new images.
```bash
sudo docker compose -f docker-compose.prod.yml up -d --pull=always --remove-orphans
```

### Apply New Migrations Only

Apply only new migrations (after update).
```bash
for f in $(ls database/migrations/*.sql | sort); do 
    cat "$f" | sudo docker exec -i forson_db psql -U postgres -d forson_business_suite
done
```

### Check Service Status

Check all services.
```bash
sudo docker compose -f docker-compose.prod.yml ps
```

Tail backend logs.
```bash
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

Check backend health.
```bash
curl -s http://localhost:3001/health || echo "Backend not responding"
```

---

## 5) Production - Backup & Recovery

### Verify Automated Backups

List backups created by backup container.
```bash
sudo docker exec forson_backup ls -lh /backups
```

Copy backup to host.
```bash
sudo docker cp forson_backup:/backups/backup-2025-10-12T03-00-00.sql.gz ./backups/
```

### Manual Backup

Create compressed backup (custom format).
```bash
sudo docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite -F c -Z 9 > backup-$(date +%Y%m%d-%H%M%S).dump
```

Create SQL backup.
```bash
sudo docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite > backup-$(date +%Y%m%d-%H%M%S).sql
gzip backup-*.sql
```

### Restore from Backup

Stop application services.
```bash
sudo docker compose -f docker-compose.prod.yml stop backend frontend
```

Rebuild database from backup using PowerShell script (Windows/WSL).
```powershell
# First restore your backup to the database manually, then:
pwsh ./scripts/rebuild_database.ps1
```

OR restore manually from dump file.
```bash
# Drop and recreate database
sudo docker exec -u postgres forson_db psql -U postgres -c "DROP DATABASE IF EXISTS forson_business_suite;"
sudo docker exec -u postgres forson_db psql -U postgres -c "CREATE DATABASE forson_business_suite OWNER postgres;"

# Restore from custom format
sudo docker cp backup-YYYYMMDD-HHMMSS.dump forson_db:/tmp/restore.dump
sudo docker exec -u postgres forson_db pg_restore -U postgres -d forson_business_suite -v /tmp/restore.dump

# OR restore from SQL
sudo docker cp backup-YYYYMMDD-HHMMSS.sql forson_db:/tmp/restore.sql
sudo docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/restore.sql
```

Restart application.
```bash
sudo docker compose -f docker-compose.prod.yml up -d backend frontend
```

---

## 6) Database Maintenance

### Vacuum Database (Reclaim Space)

Run VACUUM to optimize database.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "VACUUM FULL ANALYZE;"
```

### Check Database Size

View database size.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT pg_size_pretty(pg_database_size('forson_business_suite'));"
```

### Reindex Database

Rebuild all indexes.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "REINDEX DATABASE forson_business_suite;"
```

---

## 7) Troubleshooting & Admin

### Container Management

List all containers.
```bash
sudo docker ps -a
```

Inspect specific service logs.
```bash
sudo docker compose -f docker-compose.prod.yml logs -f backend
```

View resource usage.
```bash
sudo docker stats
```

Restart a specific service.
```bash
sudo docker compose -f docker-compose.prod.yml restart backend
```

Restart all services.
```bash
sudo docker compose -f docker-compose.prod.yml restart
```

### Database Access

Open psql session in the database container.
```bash
sudo docker exec -it forson_db psql -U postgres -d forson_business_suite
```

Check database connection.
```bash
sudo docker exec forson_db pg_isready -U postgres -d forson_business_suite
```

List all tables.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "\dt"
```

### Container Shell Access

Open shell in backend container.
```bash
sudo docker exec -it forson_backend sh
```

Open shell in database container.
```bash
sudo docker exec -it forson_db sh
```

### Service Health Checks

Check backend health endpoint.
```bash
curl -s http://localhost:3001/health | jq .
```

Check frontend.
```bash
curl -s http://localhost:8090/health
```

Test database from backend container.
```bash
sudo docker exec forson_backend sh -c 'nc -zv db 5432'
```

### Emergency Recovery

Stop all services immediately.
```bash
sudo docker compose -f docker-compose.prod.yml down
```

Remove all containers and volumes (DESTRUCTIVE - backup first!).
```bash
sudo docker compose -f docker-compose.prod.yml down -v
```

Clean Docker system (remove unused images, containers, networks).
```bash
sudo docker system prune -a
```

---

## 8) Monitoring

### Check Backup Status

View backup container logs.
```bash
sudo docker logs forson_backup --tail=50
```

List available backups.
```bash
sudo docker exec forson_backup ls -lh /backups
```

### Database Metrics

Active database connections.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT count(*) FROM pg_stat_activity;"
```

Slow queries (> 5 seconds).
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds';"
```

Table sizes.
```bash
sudo docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;"
```

### Disk Space

Check disk usage.
```bash
df -h
```

Check Docker volumes size.
```bash
sudo du -sh /var/lib/docker/volumes/forson_*
```

---

## 9) Security

### Update System Packages

Update Ubuntu/Debian system.
```bash
sudo apt update && sudo apt upgrade -y
```

### Secure .env File

Set restrictive permissions on .env file.
```bash
chmod 600 .env
```

Verify .env is not in git.
```bash
git status .env
# Should show: "nothing to commit" or file is in .gitignore
```

### Firewall Configuration

Enable firewall (Ubuntu).
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## Quick Reference

| Task | Command |
|------|---------|
| **Start production** | `sudo docker compose -f docker-compose.prod.yml up -d` |
| **Stop production** | `sudo docker compose -f docker-compose.prod.yml down` |
| **View logs** | `sudo docker compose -f docker-compose.prod.yml logs -f` |
| **Check status** | `sudo docker compose -f docker-compose.prod.yml ps` |
| **Backup DB** | `sudo docker exec -u postgres forson_db pg_dump -U postgres -d forson_business_suite > backup.sql` |
| **Restart service** | `sudo docker compose -f docker-compose.prod.yml restart <service>` |
| **Check health** | `curl http://localhost:3001/health` |
| **Production readiness** | `./scripts/check_production_readiness.sh` |
| **Automated deploy** | `./scripts/deploy_production.sh` |
| **Rebuild DB** | `pwsh ./scripts/rebuild_database.ps1` |

---

## Notes

- **rebuild_database.ps1**: Use for fresh installs or when recovering from backup. This script drops and recreates the database, applies the schema, and runs all migrations. **Do not use on production with existing data unless you have a backup!**

- **Automated Scripts**: The new automation scripts (`check_production_readiness.sh`, `deploy_production.sh`) simplify deployment and reduce human error. Use them for fresh production installs.

- **Migrations**: During updates, only new migrations should be applied. The migration loop in section 4 is idempotent and safe to re-run.

- **Backups**: The backup container runs daily automated backups. Always verify backups are working and test restoration procedures.

- **Security**: Never commit `.env` files. Always use strong, unique passwords for production. Enable SSL/TLS before going live.

---

**For detailed production deployment instructions, see [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md)**