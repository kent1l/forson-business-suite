import { Stack } from 'expo-router';
import RequirePermission from '../../components/RequirePermission';

/**
 * Stock lookup.
 *
 * Gated on the union of what the screens beneath actually call: power search
 * accepts `parts:view` or `pos:use`, while movement history needs
 * `inventory:view`. Gating on `inventory:view` alone would shut out counter
 * staff who can legitimately search the catalogue.
 */
export default function StockLayout() {
  return (
    <RequirePermission permission={['inventory:view', 'parts:view', 'pos:use']} title="Stock">
      <Stack screenOptions={{ headerShown: false }} />
    </RequirePermission>
  );
}
