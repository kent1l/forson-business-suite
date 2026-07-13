# Payment Methods Reference Manual

This manual provides a detailed overview of the payment methods available in the system. It is designed to help operators, accountants, and developers understand how each payment method is processed, when it should be used, and how it impacts system mathematics such as invoice balances, collected cash, and Accounts Receivable (A/R).

---

## 1. Cash & GCash (Instant Settlement)

### Description
These are **Instant Settlement** payment methods. Funds are received immediately at the point of sale.

### When to Use
Use these methods when a customer pays in full or partially at the exact moment of the transaction using physical currency (Cash) or an instant mobile wallet transfer (GCash).

### Example Scenario
A customer buys ₱5,000 worth of goods and hands over ₱5,000 in cash. The cashier records a Cash payment. The transaction is instantly considered complete, and the funds are ready to be deposited or used.

### Mathematical Computation & System Impact
*   **Payment Status:** Recorded immediately as `'settled'`.
*   **Invoice `amount_paid`:** Instantly increases by the payment amount.
*   **Invoice Status:** 
    *   Changes to **'Paid'** if `amount_paid` >= `total_amount`.
    *   Changes to **'Partially Paid'** if `amount_paid` < `total_amount`.
*   **Balance Due:** `total_amount` - `amount_paid` (Decreases immediately).
*   **Accounts Receivable (A/R):** No increase in A/R for the settled amount.
*   **Sales History Metrics:** Immediately added to "Amount Collected" and "Cash Mix". 

---

## 2. Cheque & Bank Transfer (Delayed Settlement)

### Description
These are **Delayed Settlement** payment methods. The customer provides a payment instrument (a cheque) or initiates a transfer, but the funds take time to clear the banking system and reflect in the company's bank account.

### When to Use
Use these methods for corporate clients or large transactions where cash is impractical, and the company must wait for the bank to verify and clear the funds (e.g., a 3-day cheque clearing period).

### Example Scenario
A corporate client purchases ₱50,000 in inventory and issues a post-dated cheque. The cashier records the payment as a Cheque. Three days later, the bank confirms the cheque has cleared, and a back-office operator manually marks the payment as "Settled" in the system.

### Mathematical Computation & System Impact
**Phase 1: Initial Recording (Uncleared)**
*   **Payment Status:** Recorded as `'pending'`.
*   **Invoice `amount_paid`:** Remains **unchanged** (₱0 increase).
*   **Invoice Status:** Remains **'Unpaid'** (or 'Partially Paid' if previous cash was given).
*   **Balance Due:** Remains unchanged. The customer still technically owes the money.
*   **Sales History Metrics:** Ignored in "Amount Collected" since the funds are not yet liquid.

**Phase 2: After Manual Settlement (Cleared)**
*   **Payment Status:** Updated to `'settled'`.
*   **Invoice `amount_paid`:** Increases by the cleared amount.
*   **Invoice Status:** Updates to **'Paid'** (if fully covered).
*   **Balance Due:** Decreases accordingly.
*   **Sales History Metrics:** The amount is now recognized as collected funds.

---

## 3. On Account (Credit / Terms)

### Description
This is a **Credit** payment method. The customer takes the goods immediately but agrees to pay for them at a later date based on approved credit terms (e.g., Net 30). 

### When to Use
Use this method for trusted, registered B2B clients who have an established credit line. 
*Note: This payment method is strictly blocked for "Walk-In" (unregistered) customers.*

### Example Scenario
A registered hardware store orders ₱100,000 worth of supplies. They check out using "On Account". The system generates the invoice and releases the goods. 30 days later, the customer pays the ₱100,000 via a bank transfer to clear their Accounts Receivable balance.

### Mathematical Computation & System Impact
**Phase 1: Checkout**
*   **Payment Status:** Recorded as `'on_account'`.
*   **Invoice `amount_paid`:** Remains **unchanged** (₱0 increase).
*   **Invoice Status:** Remains **'Unpaid'**.
*   **Accounts Receivable (A/R):** The entire transaction amount is added to the customer's outstanding A/R balance and begins aging based on the invoice due date.
*   **Sales History Metrics:** Reflected under "A/R Outstanding" and is strictly excluded from "Amount Collected".

**Phase 2: Payment Collection (Later Date)**
*   When the customer eventually pays their A/R balance, the payment is recorded via the Accounts Receivable module (Receive Payment). 
*   This creates a new payment record (e.g., Cash or Bank Transfer) that allocates funds to the unpaid invoice.
*   **Invoice `amount_paid`:** Increases by the allocated amount.
*   **Invoice Status:** Updates to **'Paid'**.
*   **Accounts Receivable (A/R):** Decreases as the debt is settled.

---

## Summary Table

| Method | Settlement Type | Initial Status | Immediate A/R Impact | Cash Collected Metric | Walk-In Allowed? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cash** | Instant | `settled` | None | Increases immediately | Yes |
| **GCash** | Instant | `settled` | None | Increases immediately | Yes |
| **Cheque** | Delayed | `pending` | Remains as debt | No (until cleared) | Yes |
| **Bank Transfer** | Delayed | `pending` | Remains as debt | No (until cleared) | Yes |
| **On Account** | Credit | `on_account` | Increases A/R debt | No | **No** |
