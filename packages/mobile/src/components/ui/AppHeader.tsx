import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight, elevation } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Defaults to true whenever there is somewhere to go back to. */
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
};

/**
 * The bar at the top of every screen.
 *
 * Four screens each hand-rolled their own version of this, with slightly
 * different paddings and back-button hit areas. One implementation means the
 * chrome is consistent and a change lands everywhere at once.
 */
export default function AppHeader({ title, subtitle, showBack = true, onBack, right }: Props) {
  const theme = useTheme();
  const router = useRouter();

  const handleBack = () => {
    if (onBack) return onBack();
    // Deep links and post-submit redirects can land on a screen with nothing
    // behind it, where popping would leave a blank stack.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[
      styles.container,
      { backgroundColor: theme.surface, borderBottomColor: theme.border },
      elevation(1),
    ]}>
      {showBack && (
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
      )}
      <View style={styles.titles}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {!!subtitle && (
          <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  backBtn: { marginRight: Spacing.one, marginLeft: -Spacing.two },
  titles: { flex: 1 },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  subtitle: { fontSize: FontSize.sm, marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
