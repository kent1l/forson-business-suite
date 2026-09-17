import { Stack } from 'expo-router';
import RequirePermission from '../../components/RequirePermission';
export default function PurchaseOrdersLayout() { return <RequirePermission permission="purchase_orders:view" title="Smart PO"><Stack screenOptions={{ headerShown: false }} /></RequirePermission>; }
