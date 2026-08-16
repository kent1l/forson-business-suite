import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import Button from './Button';

/**
 * The three things a data-backed screen can be showing besides data.
 *
 * Grouped in one file because they share a layout and are almost always
 * imported together.
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.body, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title, description, icon = 'file-tray-outline',
}: { title: string; description?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={40} color={theme.textMuted} />
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {!!description && (
        <Text style={[styles.body, { color: theme.textMuted }]}>{description}</Text>
      )}
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: { title?: string; description?: string; onRetry?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={40} color={theme.danger} />
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {!!description && (
        <Text style={[styles.body, { color: theme.textMuted }]}>{description}</Text>
      )}
      {onRetry && <Button label="Try again" icon="refresh" variant="secondary" size="sm" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.six,
    gap: Spacing.two,
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  body: { fontSize: FontSize.base, textAlign: 'center', lineHeight: 20 },
});
