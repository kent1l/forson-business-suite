import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../api/client';
import useAuthStore from '../store/useAuthStore';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

export default function ProfileScreen() {
  const theme = useTheme();
  const { user, logout } = useAuthStore();

  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUpdateProfile = async () => {
    if (!username.trim()) {
      Alert.alert('Username required', 'Your username cannot be empty.');
      return;
    }
    if (password && password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Type the same new password in both fields.');
      return;
    }

    setIsLoading(true);
    try {
      await apiClient.put('/profile', {
        username: username.trim(),
        password: password ? password : undefined,
      });
      // Credentials changed underneath the session, so the token no longer
      // reflects reality -- signing out is the honest outcome.
      Alert.alert(
        'Profile updated',
        'Please sign in again with your new details.',
        [{ text: 'OK', onPress: () => logout() }],
      );
    } catch (error: any) {
      Alert.alert('Could not update profile', error.response?.data?.message || 'Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text },
  ];

  const readOnlyStyle = [
    styles.input,
    { backgroundColor: theme.surfaceSunken, borderColor: theme.border, color: theme.textMuted },
  ];

  const initials = `${user?.first_name?.[0] ?? ''}${user?.last_name?.[0] ?? ''}`.toUpperCase();

  return (
    <Screen scroll padded>
      <AppHeader title="My Profile" />

      <View style={styles.body}>
        <Card style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
            <Text style={[styles.avatarText, { color: theme.primary }]}>{initials || '?'}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Team Member'}
            </Text>
            <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
              @{user?.username}
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Your Details</Text>
          <Text style={[styles.helper, { color: theme.textMuted }]}>
            Your name is managed by HR and cannot be changed here.
          </Text>

          <Text style={[styles.label, { color: theme.textSecondary }]}>First name</Text>
          <TextInput style={readOnlyStyle} value={user?.first_name || ''} editable={false} />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Last name</Text>
          <TextInput style={readOnlyStyle} value={user?.last_name || ''} editable={false} />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Username</Text>
          <TextInput
            style={inputStyle}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={theme.textMuted}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Change Password</Text>
          <Text style={[styles.helper, { color: theme.textMuted }]}>
            Leave both fields blank to keep your current password.
          </Text>

          <Text style={[styles.label, { color: theme.textSecondary }]}>New password</Text>
          <TextInput
            style={inputStyle}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.textMuted}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Confirm new password</Text>
          <TextInput
            style={inputStyle}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.textMuted}
          />

          {!!password && password !== confirmPassword && (
            <View style={styles.mismatch}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
              <Text style={[styles.mismatchText, { color: theme.warning }]}>
                The two passwords do not match yet.
              </Text>
            </View>
          )}
        </Card>

        <Button
          label="Save changes"
          icon="save-outline"
          fullWidth
          loading={isLoading}
          onPress={handleUpdateProfile}
        />
        <Text style={[styles.footnote, { color: theme.textMuted }]}>
          Saving signs you out so you can confirm your new details.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three, paddingBottom: Spacing.five },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 52, height: 52, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  identityText: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  meta: { fontSize: FontSize.sm, marginTop: 1 },

  card: { gap: Spacing.two },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  helper: { fontSize: FontSize.sm, lineHeight: 18, marginBottom: Spacing.one },
  label: {
    fontSize: FontSize.xs, fontWeight: FontWeight.heavy,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.two,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: FontSize.base,
  },
  mismatch: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  mismatchText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  footnote: { fontSize: FontSize.sm, textAlign: 'center', lineHeight: 18 },
});
