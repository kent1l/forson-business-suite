# Historical Reference and Liability Audit Report
Date: 2026-10-20
Status: Complete — Read-only audit conducted prior to Phase 1 migrations.

## 1. Summary of Existing Data

### Supplier Bills (table: `supplier_bill`)
- Total bills: 86
- Bills with `grn_id` (auto goods bills): 64 -> classified as `receipt_derived`
- Bills linked as freight (in `goods_receipt_freight`): 14 -> classified as `freight`
- Manual bills (no `grn_id`, not in freight): 8
  - `bill_id 33`: `WB112419` (supplier 42, CDO pickup freight/waybill)
  - `bill_id 70`: `26-401-003856` (supplier 24, manual invoice payable)
  - `bill_id 71`: `26-401-003531` (supplier 24, manual invoice payable)
  - `bill_id 72`: `26-401-003571` (supplier 24, manual invoice payable)
  - `bill_id 73`: `BILL-202610-0020` (supplier 5, manual payable)
  - `bill_id 74`: `BILL-202610-0021` (supplier 25, manual payable)
  - `bill_id 84`: `10431` (supplier 10, manual invoice payable)
  - `bill_id 85`: `10374` (supplier 10, manual invoice payable, has attached GRN 438)

Historical `bill_number` values are kept intact. For manual bills where `bill_number` is a supplier invoice number, that value serves as a verified initial identity.

### Goods Receipts (table: `goods_receipt`)
- Total GRNs: 418
- GRNs with `bill_id`: 65
- GRNs with `supplier_invoice_no`: 54
- GRNs with `physical_receipt_no`: 45
- Collisions found: 0 duplicate active supplier invoice numbers, 0 duplicate active physical receipt numbers.

### Active Draft Predicate Audit
- `uq_goods_receipt_supplier_physical_receipt` and `uq_goods_receipt_supplier_physical_receipt_normalized` previously only excluded `status = 'Voided'`.
- Cancelled drafts (`workflow_status = 'Cancelled'`) remained blocked from reusing delivery receipt numbers.
- Required resolution: Index filter and query lookup must exclude both `status = 'Voided'` AND `workflow_status = 'Cancelled'`.

### Supplier Merge Policy (`masterDataMergePolicy.js`)
- Currently updates `supplier_id` on `supplier_bill`, `goods_receipt`, and `goods_receipt.freight_supplier_id`.
- The new `supplier_bill_document_identity` table will add a merge rule `['supplier_bill_document_identity', 'supplier_id', 'move']` and guard against collisions during merge.
