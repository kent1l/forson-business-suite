# Sales History Page - User & Technical Manual

This manual provides detailed instructions on how to use, interpret, and maintain the Sales History Page. It covers both daily operational workflows (cashier drawer count reconciliation) and financial reporting guidelines, including detailed mathematical formulas and step-by-step scenario walkthroughs.

---

## 1. Overview & Business Purpose

The Sales History Page serves two distinct roles in the business:
1. **Daily Operations (Cash Drawer Reconciliation)**: Allows cashiers and managers to count and verify the physical till at the end of the shift/day.
2. **Financial Reporting (Accrual & VAT Compliance)**: Provides the accounting team with tax-exclusive revenue metrics and net VAT liabilities.

To avoid confusion between these two views, the page divides summary statistics into **Operational Cash Flow (Tax-Inclusive)** and **Accrual & Revenue Statistics (Tax-Exclusive)**.

---

## 2. Page Features & Navigation

### A. Date Range & Search Filters
* **Date Filters**: Select a **Start Date** and **End Date** to view transactions. Manila timezone (`Asia/Manila`) is applied to filter boundaries.
* **Shortcuts**: Quick links like *Today*, *Yesterday*, *This Week*, *This Month*, etc., are available for fast date selection.
* **Power Search**: Search dynamically across:
  * Invoice Number (e.g., `INV-2026-000123`)
  * Physical Receipt Number (e.g., `DR-4652`)
  * Customer Name (First or Last)
  * Line Item Details (Part numbers, descriptions, brands, or group names)

### B. Invoices List Table
* Displays all matching invoices in a sortable grid.
* Columns include: **Invoice #**, **Physical Receipt No.**, **Date**, **Customer**, **Status**, and **Total Amount** (tax-inclusive).
* **Clicking any row** opens the **Invoice Details Modal**, which displays line-item breakdowns, historical payments, tax details, and allows processing refunds (Credit Notes).

---

## 3. Summary Statistics Section

Clicking the **Show / Hide** toggle on the Summary card expands the detailed breakdown.

```
+--------------------------------------------------------------------------------+
|  Summary                                                        [Show / Hide]  |
|                                                                                |
|  [ OPERATIONAL CASH RECONCILIATION ]      [ FINANCIAL REVENUE & TAXES ]        |
|                                                                                |
|  Expected Net Cash (Drawer)              Gross Sales (Excl. VAT)               |
|  ₱8,450.00                               ₱10,000.00                            |
|  (Tendered: ₱9,000 | Change: ₱550)       (VAT Collected: ₱1,200)               |
|                                                                                |
|  Non-Cash Collections                    Net Sales (Excl. VAT)                 |
|  ₱3,150.00                               ₱9,500.00                             |
|  (Card: ₱2,000 | GCash: ₱1,150)          (Refunds: ₱500)                       |
|                                                                                |
|  Total Collections (Tax-Inclusive)       Outstanding A/R                       |
|  ₱11,600.00                              ₱2,400.00                             |
+--------------------------------------------------------------------------------+
```

### A. Operational Cash Reconciliation (Tax-Inclusive)
*These figures represent actual currency moving through the register and **include tax**.*

* **Expected Net Cash (Drawer)**: The target amount of physical cash that should be in the register.
  $$\text{Expected Net Cash (Drawer)} = \text{Cash Tendered} - \text{Change Returned} - \text{Refunds Paid (Approx)}$$
* **Non-Cash Collections**: The sum of digital and cheque payments (e.g., Credit Card, GCash, Bank Transfer).
* **Tendered & Change**: Detail fields displaying total physical cash handed over by customers vs. change given back.
* **Refunds Out (Approx)**: Credit Note refunds processed during the period (assumed cash payouts).
* **Cash Mix**: The ratio of cash collections to total collections:
  $$\text{Cash Mix} = \frac{\text{Expected Net Cash}}{\text{Expected Net Cash} + \text{Non-Cash Collected}}$$

### B. Accrual & Revenue Statistics (Tax-Exclusive)
*These figures exclude VAT/Sales Tax, representing clean accounting revenues.*

* **Gross Sales**: Sum of the tax-exclusive base prices for all active invoices issued in the period (excluding Cancelled invoices).
* **Refunds**: Sum of the tax-exclusive base values of all Credit Notes issued in the period.
* **Net Sales**: Gross Sales minus Refunds (excluding VAT).
* **Net VAT Collected**: Total VAT collected on sales minus VAT refunded on credit notes:
  $$\text{Net VAT} = \text{VAT on Sales} - \text{VAT on Refunds}$$
  *This is the net liability that must be reported to the tax authority.*
* **Outstanding A/R**: Total unpaid balances (tax-inclusive, as customers are legally liable for the full amount).

---

## 4. Operational Guidelines: End-of-Day Cashier Reconciliation Workflow

At the end of a shift or business day, the cashier and supervisor should perform the following steps to reconcile the register:

1. **Filter by Date**: Set the start and end dates to the current date.
2. **Retrieve "Expected Net Cash (Drawer)"**: Note down this figure from the Summary card.
3. **Count the Till**: Physically count the paper bills and coins in the cash drawer (excluding the starting drawer float).
4. **Identify Discrepancies**:
   * If physical count = Expected Net Cash: **Reconciliation Balanced**.
   * If physical count > Expected Net Cash: **Drawer Overage** (investigate if change was underpaid).
   * If physical count < Expected Net Cash: **Drawer Shortage** (investigate missing cash transactions or incorrect change given).
5. **Verify Non-Cash Slips**:
   * Group and sum physical Credit Card terminals and GCash transaction receipts.
   * Compare the sums against the **Non-Cash Collections** breakdown on the summary card to ensure terminal transactions match the invoices recorded in the system.

---

## 5. Mathematical Computations Reference

Below are the exact mathematical equations used to derive each summary metric on the dashboard.

### A. Variable Glossary
Let $I$ be the set of active invoices in the selected period (excluding `'Cancelled'`).  
Let $P$ be the set of settled payments allocated to invoices in $I$ during the period.  
Let $CN$ be the set of credit notes (refunds) issued in the period.  
* $inv.total\_amount$: Tax-inclusive invoice amount.
* $inv.subtotal\_ex\_tax$: Tax-exclusive invoice base.
* $inv.tax\_total$: VAT charged on invoice.
* $inv.amount\_paid$: Total settled payments on invoice.
* $inv.balance\_due$: Outstanding balance due.
* $p.amount$: Net payment amount allocated (actual money applied).
* $p.tendered\_amount$: Cash amount handed over by client.
* $cn.total\_amount$: Tax-inclusive refund amount.
* $cn.subtotal\_ex\_tax$: Tax-exclusive refund base.
* $cn.tax\_total$: VAT refunded on credit note.

---

### B. Metric Formulas

#### 1. Expected Net Cash (Drawer)
$$\text{Expected Net Cash} = \sum_{p \in P_{\text{cash}}} p.tendered\_amount - \sum_{p \in P_{\text{cash}}} (p.tendered\_amount - p.amount) - \sum_{cn \in CN} cn.total\_amount$$
*Simplifies operationally to:*
$$\text{Expected Net Cash} = \sum_{p \in P_{\text{cash}}} p.amount - \sum_{cn \in CN} cn.total\_amount$$

#### 2. Non-Cash Collections
$$\text{Non-Cash Collections} = \sum_{p \in P_{\text{non-cash}}} p.amount$$

#### 3. Total Collections
$$\text{Total Collections} = \text{Expected Net Cash} + \text{Non-Cash Collections}$$

#### 4. Cash Mix
$$\text{Cash Mix} = \frac{\text{Expected Net Cash} + \sum_{cn \in CN} cn.total\_amount}{\text{Total Collections} + \sum_{cn \in CN} cn.total\_amount}$$
*(Calculated using net cash collections to avoid distortion from customer change).*

#### 5. Gross Sales (Excl. VAT)
$$\text{Gross Sales} = \sum_{inv \in I} inv.subtotal\_ex\_tax$$

#### 6. Refunds (Excl. VAT)
$$\text{Refunds} = \sum_{cn \in CN} cn.subtotal\_ex\_tax$$

#### 7. Net Sales (Excl. VAT)
$$\text{Net Sales} = \text{Gross Sales} - \text{Refunds}$$

#### 8. Net VAT Collected
$$\text{Net VAT Collected} = \sum_{inv \in I} inv.tax\_total - \sum_{cn \in CN} cn.tax\_total$$

#### 9. Outstanding A/R (Tax-Inclusive)
$$\text{Outstanding A/R} = \sum_{inv \in I} \max(0, (inv.total\_amount - inv.refunded\_amount) - inv.amount\_paid)$$

---

## 6. Concrete Scenarios & Walkthroughs

### Scenario A: Split Payment & Cash Change
A customer purchases items totaling **₱1,120.00** (composed of **₱1,000.00** subtotal plus **₱120.00** VAT of 12%).
* The customer pays **₱500.00** via Credit Card.
* The customer pays the remaining **₱620.00** using a **₱1,000.00** bill in cash. The cashier returns **₱380.00** cash as change.

**Reconciliation metrics for this transaction:**
* **Operational Cash Flow (Tax-Inclusive)**:
  * **Cash Inflow (Tendered)** = ₱1,000.00
  * **Change Returned** = ₱380.00
  * **Expected Net Cash (Drawer)** = ₱1,000.00 - ₱380.00 = **₱620.00** *(The cashier must have ₱620.00 cash in the drawer).*
  * **Non-Cash Collections** = **₱500.00** *(Supervisors check terminal slip matches ₱500.00).*
  * **Total Collections** = ₱620.00 + ₱500.00 = **₱1,120.00**
  * **Cash Mix** = ₱620.00 / ₱1,120.00 = **55.4%**
* **Accrual & Revenue Statistics (Tax-Exclusive)**:
  * **Gross Sales (Excl. VAT)** = **₱1,000.00** *(The corporate income statement recognizes ₱1,000.00 as revenue).*
  * **VAT Collected** = **₱120.00** *(Tax liability owed to government).*
  * **Net Sales (Excl. VAT)** = **₱1,000.00**

---

### Scenario B: Refund (Credit Note)
The next day, the customer returns a part worth **₱224.00** (composed of **₱200.00** subtotal + **₱24.00** VAT) from the previous purchase. The store issues a Credit Note and refunds the customer in cash from the drawer.

**Reconciliation metrics for this refund transaction:**
* **Operational Cash Flow (Tax-Inclusive)**:
  * **Refunds Paid (Approx)** = **₱224.00**
  * **Expected Net Cash (Drawer)** = Previous Cash (₱620.00) - Refund (₱224.00) = **₱396.00** *(The register float drops to ₱396.00).*
* **Accrual & Revenue Statistics (Tax-Exclusive)**:
  * **Gross Sales (Excl. VAT)** = ₱1,000.00
  * **Refunds (Excl. VAT)** = **₱200.00** *(Tax-exclusive reduction in sales).*
  * **Net Sales (Excl. VAT)** = ₱1,000.00 - ₱200.00 = **₱800.00** *(Net accounting revenue adjusted to ₱800.00).*
  * **Net VAT Collected** = ₱120.00 - ₱24.00 = **₱96.00** *(Tax liability adjusted down).*
