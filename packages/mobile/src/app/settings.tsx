import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import axios from 'axios';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import useServerReachability from '../hooks/useServerReachability';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const { logout } = useAuthStore();
  const { serverIp, setServerIp } = useSettingsStore();
  const { status, recheck } = useServerReachability();

  const [tempIp, setTempIp] = useState(serverIp);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    if (!tempIp.trim()) {
      setTestResult({ success: false, message: 'Please enter a server address.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);

    const cleanIp = tempIp.trim();
    const formattedIp = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;

    try {
      const response = await axios.get(`${formattedIp}/api/health`, { timeout: 3000 });
      if (response.status === 200 || response.data?.status === 'healthy') {
        setTestResult({ success: true, message: 'Connection successful.' });
      } else {
        setTestResult({ success: false, message: `Unexpected status: ${response.status}` });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.response?.data?.message || 'Could not reach the server. Check the address and that it is running.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!tempIp.trim()) {
      Alert.alert('Server address required', 'Enter the address of the Forson server.');
      return;
    }
    await setServerIp(tempIp.trim());
    recheck();
    Alert.alert('Saved', 'Server address updated.');
  };

  const handleLogout = () => {
    Alert.alert('Log out?', 'You will need to sign in again to use the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const connection = {
    online: { label: 'Connected', tone: 'success' as const },
    offline: { label: 'Not reachable', tone: 'danger' as const },
    checking: { label: 'Checking', tone: 'neutral' as const },
  }[status];

  return (
    <Screen scroll padded>
      <AppHeader title="Settings" />

      <View style={styles.body}>
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardHeadText}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Server</Text>
              <Text style={[styles.helper, { color: theme.textMuted }]}>
                The address of the Forson server on your shop network.
              </Text>
            </View>
            <StatusBadge label={connection.label} tone={connection.tone} />
          </View>

          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.surfaceMuted, borderColor: theme.border, color: theme.text },
            ]}
            placeholder="e.g. 10.10.1.116:3001"
            placeholderTextColor={theme.textMuted}
            value={tempIp}
            onChangeText={(text) => {
              setTempIp(text);
              setTestResult(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {testResult && (
            <View style={[
              styles.result,
              { backgroundColor: testResult.success ? theme.successSoft : theme.dangerSoft },
            ]}>
              <Ionicons
                name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={testResult.success ? theme.success : theme.danger}
              />
              <Text style={[
                styles.resultText,
                { color: testResult.success ? theme.success : theme.danger },
              ]}>
                {testResult.message}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Button
              label="Test"
              variant="secondary"
              icon="pulse-outline"
              loading={isTesting}
              onPress={handleTestConnection}
              style={styles.action}
            />
            <Button label="Save" icon="save-outline" onPress={handleSaveSettings} style={styles.action} />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>About</Text>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: theme.textMuted }]}>App version</Text>
            <Text style={[styles.aboutValue, { color: theme.text }]}>
              {Constants.expoConfig?.version ?? 'unknown'}
            </Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, { color: theme.textMuted }]}>Server</Text>
            <Text style={[styles.aboutValue, { color: theme.text }]} numberOfLines={1}>
              {serverIp || 'Not configured'}
            </Text>
          </View>
        </Card>

        <Button
          label="Log Out"
          icon="log-out-outline"
          variant="danger"
          fullWidth
          onPress={handleLogout}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.three, paddingBottom: Spacing.five },
  card: { gap: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardHeadText: { flex: 1 },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  helper: { fontSize: FontSize.sm, marginTop: 2, lineHeight: 18 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: FontSize.base,
  },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    padding: Spacing.three, borderRadius: Radius.sm,
  },
  resultText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  aboutLabel: { fontSize: FontSize.base },
  aboutValue: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold, textAlign: 'right' },
});
