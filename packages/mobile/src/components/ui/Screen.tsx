import React from 'react';
import { View, ScrollView, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme, useThemeName } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  /** Wraps the content in a ScrollView. Leave off for screens that own a list. */
  scroll?: boolean;
  padded?: boolean;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * The outer shell every screen sits in.
 *
 * Exists because the safe-area, background colour and status-bar handling were
 * previously copy-pasted into each screen, which is how six of them ended up
 * light-mode only -- the dark background was simply never added to those copies.
 */
export default function Screen({
  children, scroll = false, padded = false, edges = ['top', 'left', 'right'], style, contentStyle,
}: Props) {
  const theme = useTheme();
  const themeName = useThemeName();

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padded && styles.padded, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }, style]} edges={edges}>
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: Spacing.four },
});
