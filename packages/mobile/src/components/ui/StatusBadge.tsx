import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Maps a server-side status string onto a tone.
 *
 * Kept in one place so 'Approved' is the same green everywhere, and so a status
 * nobody anticipated renders as neutral rather than crashing on a missing key.
 */
export const toneForStatus = (status?: string | null): Tone => {
  switch ((status || '').toLowerCase()) {
    case 'approved': case 'posted': case 'paid': case 'cleared': case 'present':
    case 'completed': case 'counted':
      return 'success';
    case 'pending': case 'draft': case 'computed': case 'queued': case 'submitted':
      return 'warning';
    case 'rejected': case 'cancelled': case 'voided': case 'bounced': case 'absent':
    case 'failed':
      return 'danger';
    case 'on leave': case 'holiday':
      return 'info';
    default:
      return 'neutral';
  }
};

export default function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme();

  const tones: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: theme.surfaceSunken, fg: theme.textSecondary },
    primary: { bg: theme.primarySoft, fg: theme.primary },
    success: { bg: theme.successSoft, fg: theme.success },
    warning: { bg: theme.warningSoft, fg: theme.warning },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
    info: { bg: theme.infoSoft, fg: theme.info },
  };
  const { bg, fg } = tones[tone];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half + 1,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
