import { Stack } from 'expo-router';
import RequirePermission from '../../components/RequirePermission';

/**
 * Employee self-service.
 *
 * Everything under here is scoped server-side to the signed-in employee, which
 * is what makes it safe to expose to every role. The gate is the union of the
 * three self-service permissions, all of which are granted to all roles -- a
 * user missing one still gets in and simply sees fewer cards.
 */
export default function HrLayout() {
  return (
    <RequirePermission
      permission={['dtr:punch', 'payslip:view_own', 'leave:request', 'dtr:view_own', 'leave:view_own']}
      title="My HR"
    >
      <Stack screenOptions={{ headerShown: false }} />
    </RequirePermission>
  );
}
