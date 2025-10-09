# Revised Technical Definitions for Sales Summary Cards

## Current Issues with Definitions

### 1. **Collected** ✅ 
Your definition is technically sound and aligns with accounting standards.

### 2. **A/R Outstanding** ✅
Your definition is correct and matches standard accounting terminology.

### 3. **Approx Net Cash** ⚠️ 
**Issue**: The current definition and implementation has several problems:
- Assumes all refunds are cash (many could be card reversals, bank transfers, store credit)
- Compares cash collected in period A with refunds issued in period A (which may be for sales from period B)
- Previously clamped to ≥0, hiding important negative cash flow information

## Proposed Improved Definitions

### Option 1: Period-Based Net Cash Flow
**Definition**: "Net cash flow from sales activities during the selected period"
**Formula**: `(Cash Collected - Change Given) - (Cash Refunds for invoices in same period)`
**Benefits**: 
- More accurate period-based calculation
- Shows true cash impact of the period's activities
- Can be negative (which is informative)

### Option 2: Simple Cash Position
**Definition**: "Net cash position from all sales transactions in the period"
**Formula**: `Cash Collected - Change Given - All Cash Refunds in Period`
**Benefits**:
- Simpler to understand
- Shows immediate cash impact
- Handles cross-period scenarios better

### Option 3: Rename to "Cash Collections Net"
**Definition**: "Net cash collected after change and refunds"
**Formula**: `(Cash Collected - Change Given) - Approximate Cash Refunds`
**Benefits**:
- Clearer name reflects what it actually measures
- Acknowledges the "approximate" nature
- Can show negative values

## Recommended Implementation

I recommend **Option 3** with these improvements:

1. **Allow negative values** (you were right about this)
2. **Better naming**: "Cash Collections Net" instead of "Approx Net Cash"
3. **Enhanced refund accuracy**: Track actual cash refunds vs. approximation
4. **Clear documentation**: Explain the approximation limitations

## Technical Improvements Needed

### 1. More Accurate Refund Tracking
The current system tracks refund payment methods but doesn't use them in calculations:

```sql
-- Current: Assumes all refunds are cash
SELECT SUM(total_amount) FROM credit_note WHERE refund_date BETWEEN...

-- Better: Only count cash refunds
SELECT SUM(cn.total_amount) 
FROM credit_note cn 
JOIN payment_methods pm ON cn.method_id = pm.method_id
WHERE cn.refund_date BETWEEN... AND pm.type = 'cash'
```

### 2. Period Alignment
Consider whether to:
- **Option A**: Match cash collected vs refunds in same date range (current)
- **Option B**: Match cash collected vs refunds for invoices created in same range
- **Option C**: Show both metrics separately

### 3. User Interface Improvements
- Show negative values in red
- Add tooltip explaining limitations
- Consider adding a "Cash Refunds" separate metric

## Recommended Changes