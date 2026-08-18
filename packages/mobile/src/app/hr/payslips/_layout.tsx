import { Stack } from 'expo-router';
import PayReauthGate from '../../../components/hr/PayReauthGate';

/** Gates both the payslip list and detail screens behind a password re-check. */
export default function PayslipsLayout() {
  return (
    <PayReauthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </PayReauthGate>
  );
}
