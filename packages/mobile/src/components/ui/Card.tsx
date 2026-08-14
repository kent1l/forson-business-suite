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

/**
 * A surface panel, optionally tappable.
 *
 * `style` is applied to the OUTERMOST element, which matters more than it
 * sounds: when a card is tappable it is wrapped in a TouchableOpacity, and that
 * wrapper — not the inner view — is what a parent flex container lays out. An
 * earlier version styled the inner view, so layout props like `width: '48%'`
 * were measured against the wrapper that was itself sizing to its content. In a
 * wrapping row that collapsed every tile to the width of its longest word and
 * broke the labels mid-word.
 */
export default function Card({ children, onPress, accent, padded = true, style }: Props) {
  const theme = useTheme();

  const cardStyle: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      padding: padded ? Spacing.four : 0,
    },
    accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
    elevation(1),
    style,
  ];

  if (!onPress) return <View style={cardStyle}>{children}</View>;

  return (
    <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
