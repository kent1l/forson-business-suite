# Tax Implementation Guide

This document outlines the comprehensive tax implementation for the Forson Business Suite, including database schema, backend services, API endpoints, and frontend integration.

## Overview

The tax system provides:
- Centralized tax calculation in the backend
- Per-line and per-invoice tax tracking
- Tax rate management through settings
- Comprehensive tax reporting
- Historical tax data backfill capabilities
- Audit trails for tax changes

## Database Schema Changes

### New Tables

1. **`invoice_tax_breakdown`** - Aggregated tax data per invoice per tax rate
2. **`tax_backfill_log`** - Audit trail for historical tax data backfill

### Modified Tables

1. **`invoice`** - Added tax totals and calculation version
2. **`invoice_line`** - Added tax snapshots and calculations per line

### Key Fields

- `tax_rate_snapshot` - Preserves tax rate at time of sale
- `tax_base` - Amount before tax calculation  
- `tax_amount` - Calculated tax amount
- `is_tax_inclusive` - Whether price includes tax
- `tax_calculation_version` - Algorithm version used

## Tax Calculation Logic

### Rounding Policy
- Per-line tax calculation with rounding to 2 decimal places
- Invoice totals = sum of rounded line amounts
- Prevents cumulative rounding errors

### Tax-Inclusive vs Tax-Exclusive
```javascript
if (isTaxInclusive) {
    // Extract tax from total price
    taxBase = lineTotal / (1 + taxRate);
    taxAmount = lineTotal - taxBase;
} else {
    // Add tax to base price
    taxBase = lineTotal;
    taxAmount = lineTotal * taxRate;
}
```

## Migration Strategy

### Phase 1: Schema Migration
```bash
# Run in order:
# 1. Add new columns and tables
database/migrations/20250918_add_tax_tracking_columns.sql

# 2. Backfill historical data (optional)
database/migrations/20250918_backfill_tax_data.sql
```

### Phase 2: Backend Deployment
- Deploy `taxCalculationService.js` 
- Update `invoiceRoutes.js` with tax calculation
- Deploy new tax reporting endpoints

### Phase 3: Frontend Updates
- Update POS page to use backend calculations
- Enhance Settings page tax management
- Update Receipt component for tax breakdown

## API Endpoints

### Tax Rates Management
- `GET /api/tax-rates` - List all tax rates
- `POST /api/tax-rates` - Create new tax rate
- `PUT /api/tax-rates/:id` - Update tax rate
- `DELETE /api/tax-rates/:id` - Delete tax rate
- `PUT /api/tax-rates/:id/set-default` - Set default rate

### Invoice with Tax
- `POST /api/invoices` - Create invoice (now includes tax calculation)
- `GET /api/invoices` - List invoices (includes tax breakdown)

### Tax Reporting
- `GET /api/tax-reports/summary` - Tax summary by period
- `GET /api/tax-reports/detailed` - Detailed invoice tax data
- `GET /api/tax-reports/export` - Export tax data as CSV
- `GET /api/tax-reports/rates-usage` - Tax rate usage statistics

## Configuration

### Settings
- `DEFAULT_IS_TAX_INCLUSIVE` - Default tax behavior for new parts
- Tax rates configured through Settings page

### Environment Variables
None required - all configuration through database and UI.

## Testing

### Unit Tests
```bash
cd packages/api
npm test -- taxCalculationService.test.js
```

### Integration Tests
- Test invoice creation with tax calculation
- Test tax breakdown storage and retrieval
- Test various tax scenarios (inclusive/exclusive, discounts)

### Test Scenarios
1. Tax-inclusive items with discounts
2. Mixed tax rates on same invoice
3. Zero tax rates and exempt items
4. Rounding edge cases
5. Backfill accuracy validation

## Performance Considerations

### Indexes
- `invoice_tax_breakdown(invoice_id)`
- `invoice_tax_breakdown(rate_percentage)`
- `invoice_line(tax_rate_id)`

### Materialized Views (Future)
For large datasets, consider materialized views for:
- Daily tax collection aggregates
- Monthly tax summaries by rate
- Year-over-year tax comparisons

### Partitioning (Scale)
When invoices > 1M records:
- Partition `invoice` and `invoice_line` by year/month
- Partition `invoice_tax_breakdown` similarly

## Monitoring & Alerts

### Key Metrics
- Tax calculation success rate
- Tax validation failures
- Invoice creation latency
- Tax report query performance

### Error Scenarios
- Tax rate not found → fallback to default
- Validation failures → log and alert
- Rounding discrepancies > 1 cent → investigate

## Rollback Plan

### Database Rollback
```sql
-- Remove new columns (destructive)
ALTER TABLE invoice DROP COLUMN IF EXISTS subtotal_ex_tax;
ALTER TABLE invoice DROP COLUMN IF EXISTS tax_total;
ALTER TABLE invoice DROP COLUMN IF EXISTS tax_calculation_version;

-- Drop new tables
DROP TABLE IF EXISTS invoice_tax_breakdown;
DROP TABLE IF EXISTS tax_backfill_log;
```

### Application Rollback
1. Revert API routes to previous version
2. Remove tax calculation service
3. Restore frontend tax calculation logic

## Troubleshooting

### Common Issues

1. **Tax totals don't match frontend display**
   - Check rounding policy differences
   - Verify tax rate snapshots vs current rates

2. **Backfill generates incorrect amounts**
   - Verify default tax rate setting
   - Check for missing part tax configurations

3. **Performance degradation**
   - Verify indexes are created
   - Check query plans for tax reports

### Debug Tools

1. **Tax Calculation Validation**
```javascript
const result = await calculateInvoiceTax(lines, parts);
console.log('Validation:', validateTaxCalculation(result));
```

2. **Tax Breakdown Analysis**
```sql
SELECT invoice_id, SUM(tax_amount) as breakdown_total, 
       (SELECT tax_total FROM invoice WHERE invoice_id = itb.invoice_id) as invoice_total
FROM invoice_tax_breakdown itb 
GROUP BY invoice_id 
HAVING ABS(SUM(tax_amount) - (SELECT tax_total FROM invoice WHERE invoice_id = itb.invoice_id)) > 0.01;
```

## Security Considerations

- Tax rate management requires admin permissions
- Tax reports require `reports:view` permission
- Audit logging for all tax rate changes
- Historical tax data marked as estimated where appropriate

## Compliance Notes

- Tax snapshots preserve audit trail for rate changes
- Backfill operations are logged with unique run IDs
- Export functionality supports compliance reporting
- All monetary calculations use appropriate precision

## Future Enhancements

1. **Multi-jurisdiction Support**
   - Compound tax rates
   - Location-based tax rules
   - Tax exemption categories

2. **Advanced Reporting**
   - Real-time tax dashboards
   - Tax reconciliation reports
   - Automated regulatory filings

3. **Integration Options**
   - External tax calculation services
   - Accounting software synchronization
   - Government reporting APIs

## Support

For issues or questions regarding the tax implementation:
1. Check this documentation
2. Review error logs in application
3. Validate database schema matches expected structure
4. Test with small datasets before production use