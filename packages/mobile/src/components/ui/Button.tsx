import React from 'react';
import {
  Text, TouchableOpacity, ActivityIndicator, StyleSheet,
  type ViewStyle, type StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

const SIZES: Record<Size, { padV: number; padH: number; font: number; icon: number }> = {
  sm: { padV: Spacing.two, padH: Spacing.three, font: FontSize.sm, icon: 16 },
  md: { padV: Spacing.three, padH: Spacing.four, font: FontSize.base, icon: 18 },
  lg: { padV: Spacing.four, padH: Spacing.five, font: FontSize.md, icon: 22 },
};

export default function Button({
  label, onPress, variant = 'primary', size = 'md',
  icon, loading = false, disabled = false, fullWidth = false, style,
}: Props) {
  const theme = useTheme();
  const dims = SIZES[size];

  const scheme: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.primary, fg: theme.primaryText },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.borderStrong },
    danger: { bg: theme.danger, fg: '#ffffff' },
    success: { bg: theme.success, fg: '#ffffff' },
    ghost: { bg: 'transparent', fg: theme.primary },
  };
  const { bg, fg, border } = scheme[variant];
  const inactive = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          paddingVertical: dims.padV,
          paddingHorizontal: dims.padH,
          borderWidth: border ? StyleSheet.hairlineWidth : 0,
          borderColor: border,
          opacity: inactive ? 0.5 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator size="small" color={fg} />
        : icon
          ? <Ionicons name={icon} size={dims.icon} color={fg} />
          : null}
      <Text style={[styles.label, { color: fg, fontSize: dims.font }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    gap: Spacing.two,
  },
  fullWidth: { alignSelf: 'stretch' },
  label: { fontWeight: FontWeight.bold },
});
