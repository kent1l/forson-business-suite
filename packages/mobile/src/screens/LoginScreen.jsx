import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal } from 'react-native';
import axios from 'axios';
import { SymbolView } from 'expo-symbols';
import apiClient from '../api/client';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuthStore();
  const { serverIp, setServerIp } = useSettingsStore();

  // Settings Modal States
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [tempIp, setTempIp] = useState(serverIp);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter both username and password.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/login', { username, password });
      const { token, user } = response.data;
      if (token && user) {
        await login(token, user);
      } else {
        Alert.alert('Login Failed', 'Invalid response from server.');
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Login Failed', error.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const openSettings = () => {
    setTempIp(useSettingsStore.getState().serverIp);
    setTestResult(null);
    setIsModalVisible(true);
  };

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

  const handleSaveSettings = () => {
    if (!tempIp.trim()) {
      Alert.alert('Error', 'IP address cannot be empty.');
      return;
    }
    setServerIp(tempIp.trim());
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
          tintColor="#4b5563"
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
          onChangeText={setUsername}
          autoCapitalize="none"
          editable={!isLoading}
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!isLoading}
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
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
                  <ActivityIndicator color="#3b82f6" size="small" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f3f4f6',
  },
  settingsButton: {
    position: 'absolute',
    top: 48,
    right: 24,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  card: {
    backgroundColor: '#fff',
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
    color: '#1f2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 32,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
    color: '#1f2937',
  },
  button: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
  },
  buttonText: {
    color: '#fff',
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
    backgroundColor: '#fff',
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
    color: '#1f2937',
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#1f2937',
    marginBottom: 12,
  },
  testResultText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },
  testSuccess: {
    color: '#10b981',
  },
  testError: {
    color: '#ef4444',
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
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  testButtonText: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#3b82f6',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  closeButton: {
    padding: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#9ca3af',
    fontWeight: '600',
    fontSize: 14,
  },
});

