# Sales History Summary Section - Formula Corrections

## Overview
This document outlines the corrections made to the Sales History Summary section formulas to ensure they accurately reflect the defined business logic and correctly calculate metrics based on the filtered transactions.

## Corrected Formulas

### 1. Collected
**Definition**: Total sales that are settled or that has been collected

**Previous Formula**: `Sum of min(amount_paid, net_amount)` (capped collection at net)
**Corrected Formula**: `Sum of amount_paid` (actual collections without capping)

**Reasoning**: The "Collected" metric should represent the actual amount collected from customers, not capped at the net amount. This allows for proper tracking of overpayments and provides accurate collection data.

### 2. A/R Outstanding
**Definition**: The total receivables

**Previous Formula**: `Sum of max(balance_due, 0)` to prevent negative A/R
**Corrected Formula**: `Sum of max(balance_due, 0)` - represents total receivables (A/R Outstanding)

**Reasoning**: The formula was already correct, but the comment and tooltip have been clarified to emphasize that this represents total receivables.

### 3. Approx Net Cash
**Definition**: The total expected amount of cash derived from the sales and other transactions like refunds and deleted invoices

**Previous Formula**: `Cash Net - Credit Notes (assumes all refunds were cash)`
**Corrected Formula**: `Net cash collected minus estimated cash refunds`

**Reasoning**: Updated the description to better reflect that this is an approximation of net cash flow from sales and related transactions.

### 4. Collection Rate
**Previous Formula**: `Amount Collected / Net Sales (capped at 100%)`
**Corrected Formula**: `Amount Collected / Net Sales (not capped, can exceed 100% due to overpayments)`

**Reasoning**: Collection rate should accurately reflect the relationship between collections and net sales, even if it exceeds 100% due to overpayments or deposits.

## Data Filtering Compliance

### Date Range Filtering
- ✅ **Invoices**: Filtered by `invoice_date` within the selected date range
- ✅ **Payments**: Filtered by `created_at` (payment date) within the same date range
- ✅ **Refunds**: Filtered by `refund_date` within the same date range

### Search Query Filtering
- ✅ **Invoices**: Filtered by search query (invoice number, customer name, items, etc.)
- ✅ **Payments**: Correctly excludes payments for deleted/filtered invoices
- ✅ **Summary Calculations**: All metrics respect the filtered invoice set

### Transaction Consistency
- ✅ **Deleted Invoice Handling**: Payments referencing deleted invoices are excluded from calculations
- ✅ **Status Filtering**: Cancelled invoices are excluded from revenue metrics
- ✅ **Reference Matching**: Payment-to-invoice relationships are properly maintained

## Verification Steps

To verify the corrected calculations:

1. **Select a date range** with known invoices and payments
2. **Check invoice data** via `/api/invoices` endpoint for:
   - `net_amount` (total - refunds)
   - `amount_paid` (actual collections)
   - `balance_due` (remaining receivables)
3. **Check payment data** via `/api/payments` endpoint for:
   - Payment amounts by method
   - Proper date filtering
   - Reference consistency
4. **Verify calculations**:
   - Collected = Sum of `amount_paid` for filtered invoices
   - A/R Outstanding = Sum of `balance_due` for filtered invoices
   - Net Sales = Sum of `net_amount` for filtered invoices
   - Collection Rate = Collected / Net Sales

## Backend Dependencies

The corrected calculations rely on the following backend data:

### Invoice Data (via `/api/invoices`)
- `total_amount`: Gross invoice amount
- `refunded_amount`: Total refunds applied
- `net_amount`: Computed as `GREATEST(total_amount - refunded_amount, 0)`
- `amount_paid`: Total payments received
- `balance_due`: Computed as `GREATEST((total_amount - refunded_amount) - amount_paid, 0)`

### Payment Data (via `/api/payments`)
- `amount_paid`: Payment amount applied to invoice
- `tendered_amount`: Amount tendered (for cash calculations)
- `payment_method`: Method used (via `COALESCE(legacy_method, method_name)`)
- `reference`: Payment reference (for deleted invoice detection)

### Refund Data (via `/api/payments/refunds-approx`)
- `total_refunds`: Sum of credit note amounts in date range

## Implementation Notes

1. **Currency Safety**: All calculations use `currencySafeNumber()` to handle null/undefined values
2. **Negative Prevention**: Balance calculations are clamped to prevent negative A/R
3. **Overpayment Handling**: Collections are not capped, allowing accurate tracking of overpayments
4. **Method Detection**: Cash/non-cash classification uses configurable payment methods when available
5. **Performance**: Calculations are memoized and only recalculate when dependencies change

## Testing Recommendations

1. **Test with overpaid invoices** to ensure collection rate can exceed 100%
2. **Test with partially refunded invoices** to verify net amount calculations
3. **Test with deleted invoices** to ensure payments are properly excluded
4. **Test with search filters** to verify summary accuracy with filtered data
5. **Test with various payment methods** to verify cash/non-cash classification