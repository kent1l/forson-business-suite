import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import apiClient from '../../api/client';
import { searchCatalog, lookupBarcode } from '../../offline/catalogQueries';
import useServerReachability from '../../hooks/useServerReachability';
import PremiumScanner from '../../components/ui/PremiumScanner';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/States';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight } from '@/constants/theme';
import { formatPHP } from '../../utils/currency';

type Part = {
  part_id: number;
  internal_sku: string;
  display_name: string;
  /** Absent when the server is unreachable -- see the stock column below. */
  stock_on_hand?: string | null;
  last_sale_price: string | null;
  wac_cost: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Scan or search any part and see what is on hand.
 *
 * The highest-frequency thing warehouse and counter staff do, and until now
 * they had to walk to a desktop for it. Power search already returns stock on
 * hand alongside the catalogue fields, so one request answers the whole
 * question.
 */
export default function StockLookupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status: reachability } = useServerReachability();
  const isOnline = reachability === 'online';

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Part[]>([]);
  const [searching, setSearching] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Guards against a slow early request landing after a later one and
  // overwriting fresher results.
  const requestSeq = useRef(0);

  /**
   * Identity comes from the local catalogue so the screen still answers "which
   * part is this" during an outage. Stock cannot: it is a live sum, so when the
   * server is gone the column goes blank rather than quoting a number that was
   * true an hour ago.
   */
  const search = useCallback(async (keyword: string) => {
    const seq = ++requestSeq.current;
    if (keyword.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const local = await searchCatalog(keyword.trim());
      if (seq !== requestSeq.current) return;

      const rows: Part[] = local.map((p) => ({
        part_id: p.part_id,
        internal_sku: p.internal_sku ?? '',
        display_name: p.display_name ?? '',
        last_sale_price: p.last_sale_price != null ? String(p.last_sale_price) : null,
        wac_cost: p.wac_cost != null ? String(p.wac_cost) : null,
        stock_on_hand: undefined,
      }));
      setResults(rows);

      if (!isOnline || rows.length === 0) return;

      const { data } = await apiClient.get(`/power-search/parts?keyword=${encodeURIComponent(keyword.trim())}`);
      if (seq !== requestSeq.current || !Array.isArray(data)) return;

      const stockById = new Map<number, string>(
        data.map((d: any) => [d.part_id, d.stock_on_hand])
      );
      setResults((prev) =>
        prev.map((r) => (stockById.has(r.part_id) ? { ...r, stock_on_hand: stockById.get(r.part_id) } : r))
      );
    } catch {
      // The local read is what this screen depends on; a failed stock overlay
      // just leaves the column blank, which is the honest outcome anyway.
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, [isOnline]);

  useEffect(() => {
    const t = setTimeout(() => search(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, search]);

  /** A scan that resolves to exactly one part goes straight to its detail. */
  const resolveBarcode = async (barcode: string) => {
    try {
      const part = await lookupBarcode(barcode);
      if (!part) return { status: 'not_found' as const };
      setScannerOpen(false);
      router.push(`/stock/${part.part_id}` as never);
      return { status: 'success' as const };
    } catch {
      return { status: 'error' as const, message: 'Could not look that up.' };
    }
  };

  const renderItem = ({ item }: { item: Part }) => {
    // Zero is a real answer and must never be how "we don't know" looks.
    const unknownStock = item.stock_on_hand === undefined || item.stock_on_hand === null;
    const qty = Number(item.stock_on_hand || 0);
    const tone = unknownStock
      ? theme.textMuted
      : qty > 0 ? theme.success : qty < 0 ? theme.danger : theme.textMuted;

    return (
      <Card onPress={() => router.push(`/stock/${item.part_id}` as never)} style={styles.resultCard}>
        <View style={styles.resultRow}>
          <View style={styles.resultInfo}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{item.display_name}</Text>
            <Text style={[styles.sku, { color: theme.textMuted }]} numberOfLines={1}>
              {item.internal_sku}
            </Text>
            {!!item.last_sale_price && (
              <Text style={[styles.price, { color: theme.textSecondary }]}>
                {formatPHP(item.last_sale_price)}
              </Text>
            )}
          </View>
          <View style={styles.qtyBox}>
            <Text style={[styles.qty, { color: tone }]}>{unknownStock ? '—' : qty}</Text>
            <Text style={[styles.qtyLabel, { color: theme.textMuted }]}>
              {unknownStock ? 'offline' : 'on hand'}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <AppHeader title="Stock Lookup" />

      <View style={[styles.searchBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={[styles.inputWrap, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
          <Ionicons name="search" size={18} color={theme.textMuted} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            value={term}
            onChangeText={setTerm}
            placeholder="Part name, SKU or number"
            placeholderTextColor={theme.textMuted}
            autoCorrect={false}
            returnKeyType="search"
          />
          {term.length > 0 && (
            <TouchableOpacity onPress={() => setTerm('')} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.scanBtn, { backgroundColor: theme.primary }]}
          onPress={() => setScannerOpen(true)}
          accessibilityLabel="Scan a barcode"
        >
          <Ionicons name="barcode-outline" size={22} color={theme.primaryText} />
        </TouchableOpacity>
      </View>

      {searching && <ActivityIndicator style={styles.spinner} color={theme.primary} />}

      <FlatList
        data={results}
        keyExtractor={(item) => String(item.part_id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          searching ? null : term.trim().length >= 2 ? (
            <EmptyState
              icon="cube-outline"
              title="No parts found"
              description="Try a different keyword, or scan the barcode."
            />
          ) : (
            <EmptyState
              icon="search-outline"
              title="Search or scan"
              description="Look up any part to see what is on hand, its price and recent movement."
            />
          )
        }
      />

      <PremiumScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onBarcodeScanned={() => setScannerOpen(false)}
        onResolveBarcode={resolveBarcode}
        title="Scan Part"
        autoCloseOnSuccess
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
  },
  input: { flex: 1, fontSize: FontSize.base, paddingVertical: Spacing.one },
  scanBtn: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  spinner: { marginTop: Spacing.three },
  list: { padding: Spacing.four, gap: Spacing.two, flexGrow: 1 },
  resultCard: {},
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  resultInfo: { flex: 1 },
  name: { fontSize: FontSize.base, fontWeight: FontWeight.semibold },
  sku: { fontSize: FontSize.sm, marginTop: 1 },
  price: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginTop: Spacing.one },
  qtyBox: { alignItems: 'flex-end', minWidth: 60 },
  qty: { fontSize: FontSize.xl, fontWeight: FontWeight.heavy },
  qtyLabel: { fontSize: FontSize.xs },
});
