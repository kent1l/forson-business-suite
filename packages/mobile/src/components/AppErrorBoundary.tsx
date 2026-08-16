import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { Colors, Spacing, FontSize, FontWeight, Radius } from '@/constants/theme';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence against a white screen.
 *
 * The app is sideloaded onto phones that are not plugged into a debugger, so a
 * render crash previously left staff with nothing to report beyond "it broke".
 * Showing the error, with the app version and a copy button, turns that into
 * something actionable.
 *
 * Uses the static palette rather than `useTheme` because hooks are unavailable
 * in a class component, and because whatever just crashed might be the theme.
 */
export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private copyDiagnostics = async () => {
    const { error } = this.state;
    await Clipboard.setStringAsync(
      [
        `App version: ${Constants.expoConfig?.version ?? 'unknown'}`,
        `Error: ${error?.message ?? 'unknown'}`,
        error?.stack ?? '',
      ].join('\n'),
    );
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const theme = Colors.light;
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[styles.title, { color: theme.text }]}>Something went wrong</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          The app hit an unexpected error. You can try again, or copy the details and send them to
          whoever supports the system.
        </Text>

        <ScrollView style={[styles.detail, { backgroundColor: theme.surfaceSunken }]}>
          <Text style={[styles.mono, { color: theme.textMuted }]}>{error.message}</Text>
        </ScrollView>

        <Text style={[styles.version, { color: theme.textMuted }]}>
          Version {Constants.expoConfig?.version ?? 'unknown'}
        </Text>

        <View style={styles.actions}>
          <Text
            style={[styles.action, { backgroundColor: theme.primary, color: theme.primaryText }]}
            onPress={this.reset}
            accessibilityRole="button"
          >
            Try again
          </Text>
          <Text
            style={[styles.action, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.borderStrong, borderWidth: StyleSheet.hairlineWidth }]}
            onPress={this.copyDiagnostics}
            accessibilityRole="button"
          >
            Copy details
          </Text>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.five, gap: Spacing.three },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.heavy },
  body: { fontSize: FontSize.base, lineHeight: 20 },
  detail: { maxHeight: 160, borderRadius: Radius.md, padding: Spacing.three },
  mono: { fontSize: FontSize.sm, fontFamily: 'monospace' },
  version: { fontSize: FontSize.xs },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two },
  action: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    fontWeight: FontWeight.bold,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
