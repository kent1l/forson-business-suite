import React from 'react';
import { View, StyleSheet } from 'react-native';
import { usePermission } from '../hooks/usePermission';
import Screen from './ui/Screen';
import AppHeader from './ui/AppHeader';
import { EmptyState } from './ui/States';

type Props = {
  /** A single key, or several with OR semantics -- matching the server. */
  permission: string | string[];
  title?: string;
  children: React.ReactNode;
};

/**
 * Gates a screen on a permission.
 *
 * The screens that had guards did them in a `useEffect` with `[]` deps that
 * called `router.back()`. That had two problems: the effect captured
 * `hasPermission` from the first render, so a user whose profile hydrated a
 * moment later was judged against an empty permission list; and bouncing the
 * user backwards leaves them wondering what happened. Rendering a plain refusal
 * is both honest and stateless.
 *
 * Screens reachable by deep link (`scheme: mobile`) need this even when the
 * dashboard already hides their tile -- hiding a button is not access control.
 */
export default function RequirePermission({ permission, title = 'Not available', children }: Props) {
  const { hasAny } = usePermission();

  if (hasAny(permission)) return <>{children}</>;

  return (
    <Screen>
      <AppHeader title={title} />
      <View style={styles.body}>
        <EmptyState
          icon="lock-closed-outline"
          title="You do not have access"
          description="Your account does not have permission for this screen. Ask a manager if you think this is wrong."
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1 } });
