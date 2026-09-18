import assert from 'node:assert/strict';
import test from 'node:test';
import { canReviewPurchaseOrder, orderTotal, summaryForPurchaseOrder } from '../src/utils/purchaseOrder.ts';

const exactLine = { client_id: '1', quantity: 2, cost_price: 135, match_status: 'exact', confirmed: true };

test('Smart PO review blocks ambiguous and unconfirmed fuzzy lines', () => {
  assert.equal(canReviewPurchaseOrder(3, [{ ...exactLine, match_status: 'ambiguous' }]), false);
  assert.equal(canReviewPurchaseOrder(3, [{ ...exactLine, match_status: 'fuzzy', confirmed: false }]), false);
  assert.equal(canReviewPurchaseOrder(3, [exactLine]), true);
  assert.equal(canReviewPurchaseOrder(null, [exactLine]), false);
});

test('Smart PO totals and supplier summary remain deterministic', () => {
  assert.equal(orderTotal([exactLine, { ...exactLine, client_id: '2', quantity: 1, cost_price: 50 }]), 320);
  const summary = summaryForPurchaseOrder({ po_id: 9, po_number: 'PO-0009', supplier_name: 'Acme', order_date: '2026-09-17', total_amount: 270 }, [{ display_name: 'NGK CPR8EA-9', quantity: 2, unit: 'PCS', cost_price: 135 }]);
  assert.match(summary, /Purchase Order PO-0009/);
  assert.match(summary, /Please confirm availability and delivery date/);
});
