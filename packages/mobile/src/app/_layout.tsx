import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import { View, Text, ActivityIndicator, TouchableOpacity, Linking, AppState } from 'react-native';
import { useEffect, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useColorScheme } from '@/hooks/use-color-scheme';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import useBrandStore from '../store/useBrandStore';
import useOutboxStore from '../offline/outbox';
import useOutboxSync from '../offline/useOutboxSync';
import useServerReachability from '../hooks/useServerReachability';
import ConnectionBanner from '../components/ui/ConnectionBanner';
import AppErrorBoundary from '../components/AppErrorBoundary';
import LoginScreen from '../screens/LoginScreen';
import apiClient from '../api/client';

const DAY_MS = 1000 * 60 * 60 * 24;

const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: DAY_MS, retry: 2 } },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

/**
 * What may be written to disk.
 *
 * Persistence exists so a phone in a dead spot still shows its assigned counts
 * and part lookups. Payroll is a different matter: these are sideloaded,
 * sometimes shared, sometimes rooted warehouse phones, and AsyncStorage is not
 * encrypted. Pay figures and leave balances are therefore never cached to disk;
 * those screens simply require a connection.
 */
const NEVER_PERSIST = ['payroll', 'payslips', 'myLeaveBalances'];

const persistOptions = {
  persister,
  maxAge: DAY_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) =>
      !NEVER_PERSIST.includes(String(query.queryKey[0])),
  },
};

/** Wires the cross-cutting background behaviour that needs to live inside the providers. */
function AppShell() {
  const colorScheme = useColorScheme();
  const { status } = useServerReachability();
  useOutboxSync(status === 'online');

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <ConnectionBanner status={status} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="count" />
        <Stack.Screen name="unassigned-search" />
        <Stack.Screen name="my-activity" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="outbox" />
        <Stack.Screen name="hr" />
        <Stack.Screen name="pos" />
        <Stack.Screen name="pos-settlement" options={{ animation: 'slide_from_right' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const { user, isHydrated: authHydrated, hydrate: hydrateAuth } = useAuthStore();
  const { isHydrated: settingsHydrated, hydrate: hydrateSettings, serverIp } = useSettingsStore();
  const hydrateOutbox = useOutboxStore((s) => s.hydrate);
  const outboxHydrated = useOutboxStore((s) => s.isHydrated);
  const pendingCount = useOutboxStore((s) => s.entries.length);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  const refreshBrand = useBrandStore((s) => s.refresh);

  const [updateRequired, setUpdateRequired] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [latestVer, setLatestVer] = useState('');
  const [currentVer, setCurrentVer] = useState('');

  useEffect(() => {
    hydrateAuth();
    hydrateSettings();
    hydrateOutbox();
    hydrateBrand();
  }, [hydrateAuth, hydrateSettings, hydrateOutbox, hydrateBrand]);

  // Keep cached permissions in step with the server. `protect` re-reads them on
  // every request, so a client that only ever saw its login response would show
  // actions the server then refuses.
  useEffect(() => {
    if (!user || !serverIp) return;
    const refreshUser = async () => {
      try {
        const { data } = await apiClient.get('/auth/me');
        useAuthStore.getState().updateUser(data);
      } catch {
        // Offline, or the session expired -- the interceptor handles the latter.
      }
    };
    refreshUser();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshUser();
    });
    return () => sub.remove();
    // Only re-subscribe when the identity or server changes, not on every user field update.
  }, [user?.employee_id, serverIp]);

  useEffect(() => {
    if (settingsHydrated && serverIp) refreshBrand();
  }, [settingsHydrated, serverIp, refreshBrand]);

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
        console.warn('OTA check skipped or failed:', (err as Error)?.message || err);
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

  // The outbox is hydrated before anything can gate the app, so the update
  // screen below can tell the user what is still unsent rather than stranding
  // queued punches behind a wall they cannot get past.
  if (!authHydrated || !settingsHydrated || !outboxHydrated) {
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

        {pendingCount > 0 && (
          <View style={{ backgroundColor: 'rgba(185, 28, 28, 0.12)', padding: 12, borderRadius: 8, width: '100%', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(185, 28, 28, 0.3)' }}>
            <Text style={{ fontWeight: 'bold', color: '#7f1d1d', marginBottom: 4 }}>
              {pendingCount} item{pendingCount === 1 ? '' : 's'} not yet synced
            </Text>
            <Text style={{ color: '#7f1d1d', lineHeight: 20 }}>
              Reconnect to the server before updating so this work is not lost. Installing over the app keeps it, but a reinstall will not.
            </Text>
          </View>
        )}

        {!!releaseNotes && (
          <View style={{ backgroundColor: 'rgba(17, 24, 39, 0.05)', padding: 15, borderRadius: 10, width: '100%', marginBottom: 30, borderWidth: 1, borderColor: 'rgba(17, 24, 39, 0.1)' }}>
            <Text style={{ fontWeight: 'bold', color: '#111827', marginBottom: 5 }}>What&apos;s New:</Text>
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
    <AppErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <AppShell />
      </PersistQueryClientProvider>
    </AppErrorBoundary>
  );
}
