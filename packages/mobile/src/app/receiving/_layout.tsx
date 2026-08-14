import { Stack } from 'expo-router';
import RequirePermission from '../../components/RequirePermission';

/**
 * Receiving against a purchase order.
 *
 * Needs both keys: the list and lines come from `purchase_orders:view`, and
 * posting the receipt needs `goods_receipt:create`. Someone holding only one of
 * them would reach a dead end, so the gate requires both up front.
 */
export default function ReceivingLayout() {
  return (
    <RequirePermission permission="goods_receipt:create" title="Receiving">
      <Stack screenOptions={{ headerShown: false }} />
    </RequirePermission>
  );
}
