import React from 'react';
import { View, TouchableOpacity, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, elevation } from '@/constants/theme';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  /** A coloured left edge, used to distinguish module tiles at a glance. */
  accent?: string;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function Card({ children, onPress, accent, padded = true, style }: Props) {
  const theme = useTheme();

  const body = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          padding: padded ? Spacing.four : 0,
        },
        accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
        elevation(1),
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
