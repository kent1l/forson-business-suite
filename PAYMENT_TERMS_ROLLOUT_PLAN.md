# Payment Terms Implementation - Rollout Plan

## Overview
This document outlines the safe rollout plan for the enhanced payment terms and due date functionality in the Forson Business Suite.

## Pre-Deployment Checklist

### 1. Code Review and Testing ✅
- [x] Backend payment terms helper with comprehensive validation
- [x] Enhanced frontend utilities with robust parsing
- [x] Updated invoice routes with proper error handling
- [x] Unit tests for both backend and frontend (all passing)
- [x] Integration tests for typical invoice scenarios

### 2. Database Migration Safety ✅
- [x] Non-destructive migration that adds indexes only
- [x] Uses `IF NOT EXISTS` for all changes
- [x] Backward compatible with existing data
- [x] No schema changes that could cause downtime

### 3. Infrastructure Review ✅
- [x] Confirmed existing schema supports payment_terms_days and due_date
- [x] Verified on_account payment status support exists
- [x] Added performance indexes for aging reports and due date queries

## Staging Deployment Plan

### Phase 1: Database Migration (Low Risk)
```bash
# 1. Create database backup
cd /path/to/app
docker-compose -f docker-compose.dev.yml exec postgres pg_dump -U forson_user forson_db > backup-pre-payment-terms-$(date +%Y%m%d).sql

# 2. Apply migration to staging
psql -U forson_user -d forson_db -f database/migrations/20250916_optimize_payment_terms_infrastructure.sql

# 3. Verify indexes were created
psql -U forson_user -d forson_db -c "\d+ invoice" | grep -E "(idx_invoice_due_date|idx_invoice_status_due_date)"
```

### Phase 2: Backend Deployment (Medium Risk)
```bash
# 1. Deploy backend changes
docker-compose -f docker-compose.dev.yml build backend
docker-compose -f docker-compose.dev.yml up -d backend

# 2. Run integration tests
cd packages/api
node tests/paymentTermsHelper.test.js

# 3. Test API endpoints manually
curl -X POST http://localhost:3001/api/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "customer_id": 1,
    "employee_id": 1,
    "terms": "Net 30",
    "payment_terms_days": 30,
    "lines": [{"part_id": 1, "quantity": 1, "sale_price": 100}]
  }'
```

### Phase 3: Frontend Deployment (Low Risk)
```bash
# 1. Build and test frontend
cd packages/web
npm run test
npm run build

# 2. Deploy frontend
docker-compose -f docker-compose.dev.yml build frontend
docker-compose -f docker-compose.dev.yml up -d frontend
```

## Production Deployment Strategy

### Pre-Production Verification
1. **Database Backup**
   ```bash
   # Create full backup before deployment
   pg_dump -h production-db-host -U forson_user forson_db > backup-production-$(date +%Y%m%d-%H%M).sql
   gzip backup-production-$(date +%Y%m%d-%H%M).sql
   ```

2. **Traffic Monitoring Setup**
   - Monitor error rates before, during, and after deployment
   - Set up alerts for 500 errors or payment validation failures
   - Prepare rollback plan if error rate exceeds 1%

3. **Feature Flag Configuration (Optional)**
   ```javascript
   // Add to settings table for gradual rollout
   INSERT INTO settings (setting_key, setting_value) VALUES 
   ('ENHANCED_PAYMENT_TERMS_ENABLED', 'true');
   ```

### Deployment Steps

#### Step 1: Database Migration (Maintenance Window: 5 minutes)
```bash
# Execute during low-traffic period
psql -h production-db -U forson_user -d forson_db -f database/migrations/20250916_optimize_payment_terms_infrastructure.sql
```

**Rollback Plan:** Migration is additive only - no rollback needed

#### Step 2: Backend Deployment (Blue-Green Deploy)
```bash
# Deploy to secondary instance first
docker-compose -f docker-compose.prod.yml up -d backend-staging

# Smoke test the staging backend
curl -f http://backend-staging:3001/api/payment-terms

# Switch traffic to new backend
# (implementation depends on your load balancer setup)
```

**Rollback Plan:** Switch traffic back to previous backend version

#### Step 3: Frontend Deployment (Rolling Update)
```bash
# Build optimized frontend
cd packages/web
npm run build

# Deploy frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

**Rollback Plan:** Revert to previous frontend image

## Post-Deployment Verification

### Immediate Checks (0-30 minutes)
- [ ] Application starts successfully
- [ ] Invoice creation works with payment terms
- [ ] GET /api/invoices returns enhanced data
- [ ] No 500 errors in logs
- [ ] Database performance within normal ranges

### Extended Monitoring (24-48 hours)
- [ ] Payment terms parsing working correctly
- [ ] Due date calculations accurate
- [ ] On-account payments still functioning
- [ ] Aging reports performance acceptable
- [ ] User feedback positive

## Testing Scenarios

### Critical Path Tests
1. **Invoice Creation with Terms**
   ```javascript
   // Test explicit payment_terms_days
   POST /api/invoices {
     payment_terms_days: 30,
     // ... other fields
   }
   
   // Test parsed terms
   POST /api/invoices {
     terms: "Net 15",
     // ... other fields
   }
   
   // Test immediate payment
   POST /api/invoices {
     terms: "Due on receipt",
     // ... other fields
   }
   ```

2. **Error Handling**
   ```javascript
   // Test invalid payment terms
   POST /api/invoices {
     payment_terms_days: -1, // Should return 400 error
     // ... other fields
   }
   ```

3. **Split Payment with On-Account**
   ```javascript
   // Test on-account payments don't affect due dates
   POST /api/invoices/:id/payments {
     payments: [{
       method_id: ON_ACCOUNT_METHOD_ID,
       amount_paid: 100
     }]
   }
   ```

### Performance Tests
- [ ] Invoice list query with due date fields (should use indexes)
- [ ] Aging report generation (should complete within 5 seconds)
- [ ] Large invoice creation (payment terms validation overhead minimal)

## Rollback Procedures

### Full Rollback (Emergency)
1. **Revert Application Code**
   ```bash
   git checkout previous-stable-commit
   docker-compose -f docker-compose.prod.yml build
   docker-compose -f docker-compose.prod.yml up -d
   ```

2. **Database Rollback (if necessary)**
   ```sql
   -- Only if absolutely necessary - these changes are non-destructive
   DROP INDEX IF EXISTS idx_invoice_due_date;
   DROP INDEX IF EXISTS idx_invoice_status_due_date;
   DROP INDEX IF EXISTS idx_invoice_payment_terms_days;
   -- ... other index drops
   ```

### Partial Rollback (Feature Disable)
```sql
-- Disable enhanced features via settings
UPDATE settings SET setting_value = 'false' 
WHERE setting_key = 'ENHANCED_PAYMENT_TERMS_ENABLED';
```

## Success Metrics

### Technical Metrics
- **Error Rate:** < 0.1% increase in 500 errors
- **Response Time:** < 50ms increase in invoice API endpoints
- **Database Performance:** No degradation in query times

### Business Metrics
- **Invoice Processing:** Maintain current throughput
- **User Adoption:** Monitor usage of payment terms features
- **Data Quality:** Verify due dates calculated correctly

## Contact Information

**Primary Contact:** System Administrator
**Secondary Contact:** Development Team
**Emergency Contact:** DevOps Team

## Documentation Updates Required

Post-deployment documentation updates:
- [ ] User manual: How to use enhanced payment terms
- [ ] API documentation: New fields and validation rules
- [ ] Admin guide: Aging reports and due date management
- [ ] Troubleshooting guide: Common payment terms issues

---

**Deployment Authorization Required From:**
- [ ] Technical Lead
- [ ] Database Administrator  
- [ ] Business Owner
- [ ] Operations Manager

**Estimated Total Deployment Time:** 30-45 minutes
**Recommended Deployment Window:** Low-traffic period (e.g., early morning)
**Risk Level:** Low (additive changes, comprehensive testing, rollback plan ready)