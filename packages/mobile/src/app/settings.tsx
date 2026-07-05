import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import axios from 'axios';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';

export default function SettingsScreen() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const { serverIp, setServerIp } = useSettingsStore();

  const [tempIp, setTempIp] = useState(serverIp);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
    } catch (error: any) {
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
    Alert.alert('Saved', 'Server IP configuration updated.');
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Logout', 
          style: 'destructive', 
          onPress: () => logout() 
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Server Configuration</Text>
          <Text style={styles.helperText}>Configure API base address</Text>

          <TextInput
            style={styles.input}
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

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.actionButton, styles.testButton]}
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
              style={[styles.actionButton, styles.saveButton]}
              onPress={handleSaveSettings}
            >
              <Text style={styles.saveButtonText}>Save IP</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerRight: {
    width: 32, // to balance the back button
  },
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  helperText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
  },
  input: {
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
  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
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
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ef4444',
    marginLeft: 8,
  },
});
