import React from 'react';
import { View, Text, FlatList, Alert, StyleSheet } from 'react-native';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, FontSize, FontWeight } from '@/constants/theme';
import useOutboxStore, { MAX_ATTEMPTS } from '../offline/outbox';
import { MUTATIONS, type OutboxEntry } from '../offline/mutations';

/**
 * What is still waiting to reach the server, and what to do about it.
 *
 * The queue drains itself, so this screen exists for the cases where it cannot:
 * an entry the server refused outright, or one that has run out of attempts.
 * Those must be visible and actionable rather than quietly discarded.
 */
export default function OutboxScreen() {
  const theme = useTheme();
  const entries = useOutboxStore((s) => s.entries);
  const retryAll = useOutboxStore((s) => s.retryAll);
  const remove = useOutboxStore((s) => s.remove);

  const stuck = entries.filter((e) => e.status === 'needs-attention').length;

  const confirmDiscard = (entry: OutboxEntry) => {
    Alert.alert(
      'Discard this item?',
      'It will not be sent to the server. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => remove(entry.id) },
      ],
    );
  };

  const renderItem = ({ item }: { item: OutboxEntry }) => {
    const def = MUTATIONS[item.kind];
    const needsAttention = item.status === 'needs-attention';

    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {def ? def.describe(item) : item.kind}
          </Text>
          <StatusBadge
            label={needsAttention ? 'Needs attention' : 'Queued'}
            tone={needsAttention ? 'danger' : 'warning'}
          />
        </View>

        <Text style={[styles.meta, { color: theme.textMuted }]}>
          Captured {new Date(item.createdAt).toLocaleString('en-PH')}
        </Text>

        {item.attempts > 0 && (
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {item.attempts} of {MAX_ATTEMPTS} attempts
            {item.lastError ? ` — ${item.lastError}` : ''}
          </Text>
        )}

        {needsAttention && (
          <Button
            label="Discard"
            variant="danger"
            size="sm"
            icon="trash-outline"
            onPress={() => confirmDiscard(item)}
            style={styles.action}
          />
        )}
      </Card>
    );
  };

  return (
    <Screen>
      <AppHeader
        title="Pending sync"
        subtitle={entries.length ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : undefined}
      />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="cloud-done-outline"
            title="Everything is synced"
            description="Work saved while offline appears here until it reaches the server."
          />
        }
        ListFooterComponent={
          stuck > 0 ? (
            <Button
              label="Retry all"
              icon="refresh"
              variant="secondary"
              onPress={retryAll}
              style={styles.retryAll}
            />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1 },
  card: { gap: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1, fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  meta: { fontSize: FontSize.sm },
  action: { alignSelf: 'flex-start', marginTop: Spacing.two },
  retryAll: { marginTop: Spacing.three },
});
