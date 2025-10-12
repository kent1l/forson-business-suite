# 🎯 Production Deployment - Final Checklist

Use this checklist when deploying Forson Business Suite to production for the first time.

---

## Pre-Deployment Checklist

### Environment Setup
- [ ] Server meets minimum requirements (2+ CPU, 4GB+ RAM, 20GB+ storage)
- [ ] Docker Engine 24.0+ installed
- [ ] Docker Compose 2.20+ installed
- [ ] Git installed
- [ ] Firewall configured (ports 80, 443 accessible)
- [ ] Domain name pointing to server IP (if using SSL)

### Repository & Files
- [ ] Repository cloned to production server
- [ ] All scripts have execute permissions (`chmod +x scripts/*.sh`)
- [ ] `.env.production.example` copied to `.env`
- [ ] All placeholder values in `.env` replaced with real values
- [ ] `.env` file permissions set to 600 (`chmod 600 .env`)

### Security Configuration
- [ ] `DB_PASSWORD` set to strong password (16+ characters, mixed types)
- [ ] `JWT_SECRET` generated (`openssl rand -base64 32`)
- [ ] `MEILISEARCH_MASTER_KEY` generated (`openssl rand -base64 32`)
- [ ] No default/placeholder passwords remaining in `.env`
- [ ] `.env` is NOT committed to git (check `.gitignore`)

### Pre-Flight Validation
- [ ] Run `./scripts/check_production_readiness.sh` - all checks pass
- [ ] Ports 5432, 3001, 7700, 8090 are available
- [ ] At least 10GB free disk space
- [ ] Database schema files present (`database/initial_schema.sql`)
- [ ] Migration files present in `database/migrations/`
- [ ] Backup script present (`backup/backup.sh`)

---

## Deployment Steps

### 1. Pull Docker Images
```bash
docker compose -f docker-compose.prod.yml pull
```
- [ ] All images pulled successfully
- [ ] No errors in output

### 2. Start Services
```bash
docker compose -f docker-compose.prod.yml up -d
```
- [ ] All containers started
- [ ] Check status: `docker compose -f docker-compose.prod.yml ps`
- [ ] All services show "healthy" or "running"

### 3. Initialize Database (Fresh Install Only)
```bash
# Wait for database
docker exec forson_db pg_isready -U postgres -d forson_business_suite

# Run automated script (PowerShell)
pwsh ./scripts/rebuild_database.ps1

# OR manual initialization
docker cp ./database/initial_schema.sql forson_db:/tmp/initial_schema.sql
docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/initial_schema.sql

for f in database/migrations/*.sql; do
    docker cp "$f" forson_db:/tmp/$(basename "$f")
    docker exec -u postgres forson_db psql -U postgres -d forson_business_suite -f /tmp/$(basename "$f")
done
```
- [ ] Schema applied without errors
- [ ] All migrations applied successfully
- [ ] Verify tables exist: `docker exec forson_db psql -U postgres -d forson_business_suite -c "\dt"`

### 4. Create Admin User
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "CHANGE_THIS_PASSWORD",
    "firstName": "Admin",
    "lastName": "User",
    "permissionLevelId": 10
  }'
```
- [ ] Admin user created successfully
- [ ] Can login via frontend at http://localhost:8090

---

## Post-Deployment Verification

### Service Health
- [ ] Frontend accessible: http://localhost:8090
- [ ] Backend API accessible: http://localhost:3001/health
- [ ] Can login with admin credentials
- [ ] All menus/features loading correctly

### Container Status
```bash
docker compose -f docker-compose.prod.yml ps
```
- [ ] All containers show "Up" status
- [ ] Health checks passing (where applicable)
- [ ] No containers restarting repeatedly

### Database Check
```bash
docker exec forson_db psql -U postgres -d forson_business_suite -c "SELECT COUNT(*) FROM employee;"
```
- [ ] Can query database successfully
- [ ] Expected tables exist
- [ ] Seed data present

### Backup System
```bash
docker logs forson_backup --tail=50
```
- [ ] Backup container running (not restarting)
- [ ] No error messages in logs
- [ ] Initial backup created (if enough time has passed)

### Log Check
```bash
docker compose -f docker-compose.prod.yml logs --tail=100
```
- [ ] No critical errors in logs
- [ ] Backend initialized successfully
- [ ] Meilisearch connected
- [ ] Database connections working

---

## SSL/TLS Setup (If Applicable)

### Certificate Installation
- [ ] SSL certificate obtained (Let's Encrypt or commercial)
- [ ] Certificate files copied to `./nginx/ssl/`
- [ ] Nginx configuration updated for HTTPS
- [ ] Frontend container restarted
- [ ] HTTPS working: https://yourdomain.com
- [ ] HTTP redirects to HTTPS

### Certificate Renewal
- [ ] Auto-renewal configured (certbot cron job)
- [ ] Test renewal: `sudo certbot renew --dry-run`

---

## Monitoring Setup

### Health Monitoring
- [ ] Health check endpoints verified
  - Backend: http://localhost:3001/health
  - Frontend: http://localhost:8090/health
- [ ] External monitoring service configured (optional)
- [ ] Alert system configured for downtime (optional)

### Log Monitoring
- [ ] Log aggregation setup (optional: ELK, Grafana, etc.)
- [ ] Log rotation verified (check docker-compose log settings)
- [ ] Error alerting configured (optional)

### Backup Monitoring
- [ ] Backup schedule verified (default: daily at container start time)
- [ ] Backup retention policy confirmed (default: 7 days)
- [ ] Backup size monitoring (ensure sufficient disk space)
- [ ] Test backup restoration procedure

---

## Security Hardening

### Firewall
- [ ] UFW or iptables configured
- [ ] Only necessary ports open (80, 443, SSH)
- [ ] Database port (5432) NOT exposed to internet
- [ ] Meilisearch port (7700) NOT exposed to internet

### System Updates
- [ ] System packages updated: `sudo apt update && sudo apt upgrade`
- [ ] Automatic security updates configured (unattended-upgrades)

### Access Control
- [ ] SSH key-based authentication configured
- [ ] Password authentication disabled
- [ ] Fail2ban installed and configured
- [ ] Root login disabled

### Application Security
- [ ] All default credentials changed
- [ ] JWT expiration configured appropriately
- [ ] Rate limiting considered (nginx or application level)
- [ ] CORS configured correctly

---

## Backup & Recovery Testing

### Backup Verification
```bash
# List backups
docker exec forson_backup ls -lh /backups

# Copy backup to host
docker cp forson_backup:/backups/backup-YYYY-MM-DD.sql.gz ./test-backup.sql.gz

# Verify backup file integrity
gunzip -t ./test-backup.sql.gz
```
- [ ] Backup files exist
- [ ] Backup files are not corrupted
- [ ] Backup size is reasonable

### Recovery Test (Optional but Recommended)
- [ ] Backup restored to test database successfully
- [ ] Data integrity verified after restoration
- [ ] Recovery procedure documented
- [ ] Recovery Time Objective (RTO) acceptable

---

## Documentation

### Internal Documentation
- [ ] Environment variables documented
- [ ] Admin credentials stored securely
- [ ] Network architecture documented
- [ ] Recovery procedures documented
- [ ] Contact information for escalations

### Team Training
- [ ] Operations team trained on deployment
- [ ] Development team aware of production environment
- [ ] Backup/recovery procedures understood
- [ ] Incident response plan in place

---

## Go-Live Checklist

### Final Checks
- [ ] All previous checklist items completed
- [ ] Performance testing completed
- [ ] Load testing completed (if applicable)
- [ ] Security scan completed
- [ ] Backup tested and verified
- [ ] Rollback plan prepared
- [ ] Monitoring dashboards ready
- [ ] Support team on standby

### DNS & Routing
- [ ] DNS records updated (if needed)
- [ ] TTL reduced before cutover (for faster propagation)
- [ ] CDN configured (if applicable)
- [ ] Load balancer configured (if applicable)

### Communication
- [ ] Stakeholders notified of deployment
- [ ] Maintenance window communicated (if needed)
- [ ] Status page updated
- [ ] Support channels ready

---

## Post Go-Live Monitoring (First 24 Hours)

### Immediate (0-1 hour)
- [ ] All services responding
- [ ] User login working
- [ ] Critical workflows tested
- [ ] No error spikes in logs
- [ ] Response times acceptable

### Short Term (1-8 hours)
- [ ] Monitor error rates
- [ ] Check resource utilization
- [ ] Verify backup completed
- [ ] Review user feedback
- [ ] Check for memory leaks

### Medium Term (8-24 hours)
- [ ] System stability confirmed
- [ ] Performance metrics within targets
- [ ] No unexpected behavior
- [ ] Backup system verified
- [ ] Log retention working

---

## Troubleshooting Quick Reference

### Service Won't Start
```bash
docker compose -f docker-compose.prod.yml logs <service>
docker compose -f docker-compose.prod.yml restart <service>
```

### Database Issues
```bash
docker exec forson_db pg_isready -U postgres
docker logs forson_db --tail=100
```

### Complete Restart
```bash
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### Emergency Rollback
```bash
docker compose -f docker-compose.prod.yml down
# Restore from backup (see PRODUCTION_DEPLOYMENT.md)
# Or revert to previous image tag
```

---

## Sign-Off

- [ ] Deployment lead reviewed checklist: _____________ Date: _______
- [ ] Operations team signed off: _____________ Date: _______
- [ ] Stakeholders approved: _____________ Date: _______

---

## Additional Resources

- **Full Guide**: [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)
- **Quick Reference**: [PRODUCTION_QUICKSTART.md](./PRODUCTION_QUICKSTART.md)
- **Summary**: [PRODUCTION_READY.md](./PRODUCTION_READY.md)
- **Main Docs**: [README.md](./README.md)

---

**Note**: This checklist should be updated as your deployment process evolves. Keep it as a living document.
