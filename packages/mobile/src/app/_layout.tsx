import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import { useColorScheme, View, Text, ActivityIndicator, TouchableOpacity, Linking, AppState } from 'react-native';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import LoginScreen from '../screens/LoginScreen';
import apiClient from '../api/client';

// Initialize the query client
const queryClient = new QueryClient();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, isHydrated: authHydrated, hydrate: hydrateAuth } = useAuthStore();
  const { isHydrated: settingsHydrated, hydrate: hydrateSettings, serverIp } = useSettingsStore();
  const [updateRequired, setUpdateRequired] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [latestVer, setLatestVer] = useState('');
  const [currentVer, setCurrentVer] = useState('');

  useEffect(() => {
    hydrateAuth();
    hydrateSettings();
  }, [hydrateAuth, hydrateSettings]);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        if (!settingsHydrated || !serverIp) return;

        const res = await apiClient.get('/setup/mobile-version');
        const latestVersion = res.data.version;
        const notes = res.data.releaseNotes;
        const currentVersion = Constants.expoConfig?.version || '1.0.0';

        setLatestVer(latestVersion || '1.0.0');
        setCurrentVer(currentVersion);

        if (latestVersion && latestVersion !== currentVersion) {
          setUpdateRequired(true);
          setReleaseNotes(notes);
          const ipWithProtocol = serverIp.startsWith('http') ? serverIp : `http://${serverIp}`;
          // Ensure we hit the frontend Nginx proxy for the static file instead of backend API
          let downloadIp = ipWithProtocol;
          if (downloadIp.includes(':3001')) {
            downloadIp = downloadIp.replace(':3001', ':8090');
          }
          setDownloadUrl(`${downloadIp}/mobile-setup`);
        } else {
          setUpdateRequired(false);
        }
      } catch (err) {
        console.warn('OTA check skipped or failed:', err?.message || err);
      }
    };

    checkVersion();

    // Re-check when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkVersion();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [settingsHydrated, serverIp]);

  if (!authHydrated || !settingsHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (updateRequired) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fbd602', padding: 20 }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12, color: '#111827' }}>Update Required</Text>
        
        <View style={{ backgroundColor: 'rgba(17, 24, 39, 0.05)', padding: 12, borderRadius: 8, marginBottom: 20, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(17, 24, 39, 0.1)' }}>
          <Text style={{ fontSize: 14, color: '#374151' }}>Current Version: <Text style={{ fontWeight: 'bold' }}>{currentVer}</Text></Text>
          <Text style={{ fontSize: 14, color: '#374151', marginTop: 4 }}>Required Version: <Text style={{ fontWeight: 'bold', color: '#b91c1c' }}>{latestVer}</Text></Text>
        </View>

        <Text style={{ fontSize: 16, textAlign: 'center', marginBottom: releaseNotes ? 20 : 30, color: '#374151', lineHeight: 24 }}>
          A newer version of the FORSON App has been deployed to the server. You must update your client to continue.
        </Text>
        {!!releaseNotes && (
          <View style={{ backgroundColor: 'rgba(17, 24, 39, 0.05)', padding: 15, borderRadius: 10, width: '100%', marginBottom: 30, borderWidth: 1, borderColor: 'rgba(17, 24, 39, 0.1)' }}>
            <Text style={{ fontWeight: 'bold', color: '#111827', marginBottom: 5 }}>What's New:</Text>
            <Text style={{ color: '#374151', lineHeight: 20 }}>{releaseNotes}</Text>
          </View>
        )}
        <TouchableOpacity
          style={{ backgroundColor: '#111827', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, elevation: 4 }}
          onPress={() => Linking.openURL(downloadUrl)}
        >
          <Text style={{ color: '#fbd602', fontSize: 16, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Download Update</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    // Wrap the entire app hierarchy with the QueryClientProvider
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="count" />
          <Stack.Screen name="unassigned-search" />
          <Stack.Screen name="my-progress" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="pos" />
          <Stack.Screen name="pos-settlement" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
