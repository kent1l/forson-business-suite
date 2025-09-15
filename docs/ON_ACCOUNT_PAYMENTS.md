# On-Account Payment Implementation

## Overview
This document describes the professional implementation of on-account payment functionality that allows users to create Accounts Receivable (AR) charges while maintaining proper accounting integrity.

## Features Implemented

### 1. Frontend (SplitPaymentModal.jsx)
- **Smart Confirmation Logic**: Allows confirming invoices when on-account payments cover remaining due
- **Confirmation Modal**: Shows clear warning when creating on-account charges
- **Button Labels**: Changes to "Confirm & Record On Account" when applicable
- **User Experience**: Clear warnings about invoice remaining unpaid and AR implications

### 2. Backend (invoiceRoutes.js)
- **Auditable Records**: Creates `invoice_payments` entries with `payment_status='on_account'`
- **Accounting Integrity**: Invoice `amount_paid` still only counts `settled` payments
- **Audit Trail**: Full payment history is preserved for compliance and reporting

### 3. Database Schema
- **Payment Status Constraint**: Added `on_account` to allowed `payment_status` values
- **Migration**: `20250915_add_on_account_payment_status.sql`

## User Experience Flow

1. **Payment Selection**: User selects "On Account" payment method
2. **Status Display**: Shows "On Account" status in payment list
3. **Confirmation Required**: Button changes to "Confirm & Record On Account"
4. **Warning Modal**: Explicit confirmation with clear implications:
   - Invoice remains unpaid
   - Creates Accounts Receivable charge
   - Transaction is auditable and reversible
5. **Result**: Invoice created with on-account payment recorded but invoice remains unpaid

## Technical Implementation

### Frontend Changes
```javascript
// Enhanced calculation logic
const onAccountTotal = payments.reduce((s,p) => {
  const method = paymentMethods.find(m => String(m.method_id) === String(p.method_id));
  const settlementType = method?.settlement_type || 'instant';
  return settlementType === 'on_account' ? s + (parseFloat(p.amount_paid) || 0) : s;
}, 0);

// Smart confirmation logic
const coveredByOnAccount = onAccountTotal >= remainingDue;
const canConfirm = errors.length === 0 && (remainingDue <= 0.01 || coveredByOnAccount);
```

### Backend Changes
```javascript
// Record on-account payments instead of skipping them
} else if (settlementType === 'on_account') {
    paymentStatus = 'on_account';
    settledAt = null;
}

// Insert payment record for audit trail
await client.query(`
    INSERT INTO invoice_payments (invoice_id, method_id, amount_paid, ...)
    VALUES ($1, $2, $3, ...)
`, [..., paymentStatus, settledAt, ...]);
```

### Database Schema
```sql
-- Payment status constraint
ALTER TABLE invoice_payments 
ADD CONSTRAINT chk_payment_status 
CHECK (payment_status IN ('settled', 'pending', 'on_account'));
```

## Benefits

### Business Benefits
1. **Faster POS Operations**: Allows quick AR charges without complex approval flows
2. **Professional Workflow**: Clear separation between payment recording and settlement
3. **Compliance Ready**: Full audit trail for all transactions
4. **Credit Management**: Foundation for credit limit and approval workflows

### Technical Benefits
1. **Data Integrity**: Invoice paid totals remain accurate
2. **Audit Trail**: All payment attempts are recorded
3. **Reporting**: On-account charges appear in payment history
4. **Reversibility**: On-account charges can be converted to actual payments

## Testing

### Manual Testing Steps
1. Open application at http://localhost:5173
2. Create an invoice
3. Add "On Account" payment method
4. Should see "On Account" status in payment list
5. Button should show "Confirm & Record On Account"
6. Click confirm - should show warning modal
7. Confirm - invoice should be created but remain unpaid
8. Check `invoice_payments` table for `payment_status='on_account'` entry

### Database Verification
```sql
-- Check on-account payments
SELECT ip.payment_id, ip.amount_paid, ip.payment_status, i.invoice_number, i.amount_paid as invoice_paid
FROM invoice_payments ip 
JOIN invoice i ON ip.invoice_id = i.invoice_id 
WHERE ip.payment_status = 'on_account';
```

## Future Enhancements

### Immediate (Optional)
- Add permission check for `invoicing:on_account`
- Add customer credit limit validation
- Add on-account payment settlement workflow

### Advanced (Phase 2)
- Customer credit scoring integration
- Automated credit approval workflows
- On-account payment aging reports
- Customer statement generation

## Configuration

### Payment Method Setup
Ensure "On Account" payment method is configured with:
```json
{
  "settlement_type": "on_account",
  "requires_reference": false,
  "change_allowed": false
}
```

### Required Permissions
- `invoicing:create` (existing)
- `invoicing:on_account` (future enhancement)

## Troubleshooting

### Common Issues
1. **Button Disabled**: Check payment method has `settlement_type: 'on_account'`
2. **Modal Not Showing**: Verify frontend build includes latest changes
3. **Database Error**: Ensure migration `20250915_add_on_account_payment_status.sql` was applied

### Debug Queries
```sql
-- Check payment method configuration
SELECT name, settlement_type, config FROM payment_methods WHERE settlement_type = 'on_account';

-- Check payment status constraint
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint 
WHERE conrelid = 'invoice_payments'::regclass AND conname = 'chk_payment_status';
```

## Conclusion

This implementation provides a professional, auditable approach to on-account payments that maintains accounting integrity while enabling efficient business operations. The solution balances user experience with technical requirements and provides a foundation for advanced credit management features.