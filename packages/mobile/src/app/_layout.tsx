import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import { useColorScheme, View, Text, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';
import LoginScreen from '../screens/LoginScreen';

// Initialize the query client
const queryClient = new QueryClient();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, isHydrated: authHydrated, hydrate: hydrateAuth } = useAuthStore();
  const { isHydrated: settingsHydrated, hydrate: hydrateSettings } = useSettingsStore();

  useEffect(() => {
    hydrateAuth();
    hydrateSettings();
  }, [hydrateAuth, hydrateSettings]);

  if (!authHydrated || !settingsHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
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
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: true, title: 'Dashboard' }} />
          <Stack.Screen name="count" options={{ headerShown: true, title: 'Active Count' }} />
          <Stack.Screen name="unassigned-search" options={{ headerShown: true, title: 'Log Unassigned Find' }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
