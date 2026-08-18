import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../../api/client';
import usePayReauthStore from '../../store/usePayReauthStore';
import Screen from '../ui/Screen';
import AppHeader from '../ui/AppHeader';
import Button from '../ui/Button';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import * as haptics from '../../utils/haptics';

type Props = { children: React.ReactNode };

/**
 * Re-gates My Pay behind the user's password.
 *
 * Payslips are the one HR screen with money on it, and a phone that's been
 * sitting unlocked for a while -- on a counter, handed to a coworker to check
 * something else -- is exactly when someone other than the account owner
 * might poke around. Confirming the password unlocks the whole My Pay stack
 * (list and detail) for PAY_REAUTH_WINDOW_MS; after that it asks again.
 */
export default function PayReauthGate({ children }: Props) {
  const theme = useTheme();
  const isUnlocked = usePayReauthStore((s) => s.isUnlocked());
  const unlock = usePayReauthStore((s) => s.unlock);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (isUnlocked) return <>{children}</>;

  const handleSubmit = async () => {
    if (!password || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post('/employees/verify-password', { password });
      haptics.success();
      unlock();
      setPassword('');
    } catch (err: any) {
      haptics.error();
      const status = err?.response?.status;
      setError(status === 401 ? 'Incorrect password' : 'Could not verify password. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <AppHeader title="My Pay" />
      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: theme.surfaceSunken }]}>
          <Ionicons name="lock-closed-outline" size={28} color={theme.info} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>Confirm your password</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          For your privacy, we ask again before showing pay details.
        </Text>

        <TextInput
          style={[styles.input, { borderColor: error ? theme.danger : theme.border, color: theme.text, backgroundColor: theme.surface }]}
          value={password}
          onChangeText={(v) => { setPassword(v); if (error) setError(''); }}
          placeholder="Password"
          placeholderTextColor={theme.textMuted}
          secureTextEntry
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        {!!error && <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>}

        <Button
          label="Unlock"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!password}
          fullWidth
          style={styles.button}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  iconBox: {
    width: 56, height: 56, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.three,
  },
  title: { fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: Spacing.one },
  subtitle: { fontSize: FontSize.sm, textAlign: 'center', marginBottom: Spacing.five },
  input: {
    alignSelf: 'stretch', borderWidth: 1.5, borderRadius: Radius.md,
    paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, fontSize: FontSize.base,
  },
  error: { fontSize: FontSize.sm, marginTop: Spacing.two, alignSelf: 'flex-start' },
  button: { marginTop: Spacing.four },
});
