import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import Button from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';
import { Spacing } from '@/constants/theme';

/**
 * Reachable when a deep link points at a route that no longer exists -- most
 * likely an old link after an app update, since the app is sideloaded and
 * versions in the field can lag.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen>
      <AppHeader title="Page not found" showBack={false} />
      <View style={styles.body}>
        <EmptyState
          icon="help-circle-outline"
          title="That screen does not exist"
          description="The link may be from an older version of the app."
        />
        <Button label="Go to dashboard" icon="home" onPress={() => router.replace('/')} style={styles.action} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center' },
  action: { alignSelf: 'center', marginTop: Spacing.four },
});
