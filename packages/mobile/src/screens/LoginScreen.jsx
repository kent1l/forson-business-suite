import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import axios from 'axios';
import { SymbolView } from 'expo-symbols';
import apiClient from '../api/client';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const theme = useTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const { login } = useAuthStore();
  const { serverIp, setServerIp } = useSettingsStore();

  // Settings Modal States
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [tempIp, setTempIp] = useState(serverIp);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setLoginError('Enter both your username and password.');
      return;
    }

    setIsLoading(true);
    setLoginError(null);
    try {
      const response = await apiClient.post('/login', { username: username.trim(), password });
      const { token, user } = response.data;
      if (token && user) {
        await login(token, user);
      } else {
        setLoginError('The server sent back an unexpected response. Please tell your supervisor.');
      }
    } catch (error) {
      const status = error.response?.status;
      const isNetworkError = !error.response
        && (error.code === 'ECONNABORTED'
          || error.message?.includes('Network Error')
          || error.message?.includes('Network request failed'));

      if (isNetworkError) {
        // The one case worth interrupting for, because the fix is a setting
        // the user can change from here.
        setLoginError('Could not reach the server.');
        Alert.alert(
          'Connection Failed',
          'Could not connect to the server. Would you like to configure the server address?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Configure', onPress: () => openSettings() },
          ],
        );
      } else if (status === 401) {
        // Expected, and entirely the user's to correct -- so it is shown inline
        // rather than behind a modal they have to dismiss before retyping, and
        // it is not logged as an application error.
        setLoginError('That username or password is not right. Please try again.');
        setPassword('');
      } else if (status === 403) {
        // Credentials were accepted; the account itself is the problem.
        setLoginError(
          error.response?.data?.message
            || 'Your account does not have access to this app. Ask a manager to check it.',
        );
      } else if (status >= 500) {
        setLoginError('The server had a problem signing you in. Please try again in a moment.');
      } else {
        setLoginError(error.response?.data?.message || 'Could not sign you in. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const openSettings = () => {
      setTempIp(useSettingsStore.getState().serverIp);
      setTestResult(null);
      setIsModalVisible(true);
  };

  useEffect(() => {
    if (!serverIp) {
      openSettings();
    }
  }, [serverIp]);

  const handleTestConnection = async () => {
    if (!tempIp.trim()) {
      setTestResult({ success: false, message: 'Please enter a server IP.' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);

    const cleanIp = tempIp.trim();
    const formattedIp = cleanIp.startsWith('http') ? cleanIp : `http://${cleanIp}`;
    const testUrl = `${formattedIp}/api/health`;

    try {
      const response = await axios.get(testUrl, { timeout: 3000 });
      if (response.status === 200 || response.data?.status === 'healthy') {
        setTestResult({ success: true, message: 'Connection successful!' });
      } else {
        setTestResult({ success: false, message: `Unexpected status: ${response.status}` });
      }
    } catch (error) {
      console.error('Test connection error:', error);
      setTestResult({
        success: false,
        message: error.response?.data?.message || 'Connection failed. Verify server is running.'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!tempIp.trim()) {
      Alert.alert('Error', 'IP address cannot be empty.');
      return;
    }
    await setServerIp(tempIp.trim());
    setIsModalVisible(false);
    Alert.alert('Saved', 'Server IP configuration updated.');
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={openSettings}
        accessibilityLabel="Server Settings"
      >
        <SymbolView
          tintColor={theme.textSecondary}
          name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
          size={24}
        />
      </TouchableOpacity>

      <View style={styles.card}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={(t) => { setUsername(t); if (loginError) setLoginError(null); }}
          autoCapitalize="none"
          editable={!isLoading}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={(t) => { setPassword(t); if (loginError) setLoginError(null); }}
          secureTextEntry
          editable={!isLoading}
        />

        {loginError && (
          <View style={styles.errorBanner} accessibilityLiveRegion="polite">
            <SymbolView
              tintColor={theme.danger}
              name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
              size={18}
            />
            <Text style={styles.errorBannerText}>{loginError}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={theme.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Log In</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Server Settings</Text>
            <Text style={styles.modalSubtitle}>Configure API base address</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 10.10.1.116:3001"
              value={tempIp}
              onChangeText={(text) => {
                setTempIp(text);
                setTestResult(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {testResult && (
              <Text style={[
                styles.testResultText,
                testResult.success ? styles.testSuccess : styles.testError
              ]}>
                {testResult.message}
              </Text>
            )}

            <View style={styles.modalButtonGroup}>
              <TouchableOpacity
                style={[styles.modalButton, styles.testButton]}
                onPress={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting ? (
                  <ActivityIndicator color={theme.primary} size="small" />
                ) : (
                  <Text style={styles.testButtonText}>Test Connection</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.saveButton]}
                onPress={handleSaveSettings}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Theme-driven. The login screen is the first thing anyone sees, and it was
 * the last surface still forcing a white card onto a dark phone.
 */
const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.background,
  },
  settingsButton: {
    position: 'absolute',
    top: 48,
    right: 24,
    padding: 10,
    backgroundColor: theme.surface,
    borderRadius: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  card: {
    backgroundColor: theme.surface,
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: theme.textMuted,
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    backgroundColor: theme.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
    color: theme.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.dangerSoft,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorBannerText: {
    flex: 1,
    color: theme.danger,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  button: {
    backgroundColor: theme.primary,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: theme.textMuted,
  },
  buttonText: {
    color: theme.primaryText,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: theme.textMuted,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: theme.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: theme.text,
    marginBottom: 12,
  },
  testResultText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },
  testSuccess: {
    color: theme.success,
  },
  testError: {
    color: theme.danger,
  },
  modalButtonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButton: {
    backgroundColor: theme.primarySoft,
    borderWidth: 1,
    borderColor: theme.primarySoft,
  },
  testButtonText: {
    color: theme.primary,
    fontWeight: 'bold',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: theme.primary,
  },
  saveButtonText: {
    color: theme.primaryText,
    fontWeight: 'bold',
    fontSize: 14,
  },
  closeButton: {
    padding: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    color: theme.textMuted,
    fontWeight: '600',
    fontSize: 14,
  },
});

