import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import useOutboxStore from '../../offline/outbox';
import type { Reachability } from '../../hooks/useServerReachability';

/**
 * Tells the user, at all times, whether their work is actually reaching the
 * server.
 *
 * Staff counting stock in a dead corner of the warehouse need to know the
 * difference between "saved" and "saved on this phone", and someone clocking in
 * needs it most of all. Silence here would mean discovering at payroll that a
 * morning's punches never left the device.
 *
 * Stays out of the way when everything is fine: nothing renders when the server
 * is reachable and the queue is empty.
 */
export default function ConnectionBanner({ status }: { status: Reachability }) {
  const theme = useTheme();
  const router = useRouter();
  const entries = useOutboxStore((s) => s.entries);

  const pending = entries.filter((e) => e.status === 'pending').length;
  const stuck = entries.filter((e) => e.status === 'needs-attention').length;

  if (status === 'online' && pending === 0 && stuck === 0) return null;
  if (status === 'checking' && entries.length === 0) return null;

  const offline = status === 'offline';
  const tone = stuck > 0
    ? { bg: theme.dangerSoft, fg: theme.danger, icon: 'alert-circle' as const }
    : offline
      ? { bg: theme.warningSoft, fg: theme.warning, icon: 'cloud-offline' as const }
      : { bg: theme.primarySoft, fg: theme.primary, icon: 'sync' as const };

  const message = stuck > 0
    ? `${stuck} item${stuck === 1 ? '' : 's'} need attention`
    : offline
      ? pending > 0
        ? `Offline — ${pending} item${pending === 1 ? '' : 's'} waiting to sync`
        : 'Offline — the server is not reachable'
      : `Syncing ${pending} item${pending === 1 ? '' : 's'}…`;

  return (
    <TouchableOpacity
      activeOpacity={entries.length ? 0.7 : 1}
      onPress={() => entries.length && router.push('/outbox')}
      accessibilityRole={entries.length ? 'button' : 'text'}
      accessibilityLabel={message}
    >
      <View style={[styles.banner, { backgroundColor: tone.bg }]}>
        <Ionicons name={tone.icon} size={15} color={tone.fg} />
        <Text style={[styles.text, { color: tone.fg }]} numberOfLines={1}>{message}</Text>
        {entries.length > 0 && <Ionicons name="chevron-forward" size={14} color={tone.fg} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  text: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
