import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { searchCatalog, lookupBarcode } from '../offline/catalogQueries';
import useCycleCountStore from '../store/useCycleCountStore';
import PremiumScanner from '../components/ui/PremiumScanner';
import RequirePermission from '../components/RequirePermission';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight, type ThemeColors } from '@/constants/theme';

const DEBOUNCE_MS = 300;

function UnassignedSearchScreenInner() {
  const theme = useTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const { startAdHocCount } = useCycleCountStore();

  // ── Search state ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Camera state ────────────────────────────────────────────────────────────
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isScanResolving, setIsScanResolving] = useState(false);
  const [pendingBarcodeToLink, setPendingBarcodeToLink] = useState<string | null>(null);

  // ── Core search function (shared by debounce + barcode scan) ─────────────
  // Reads the local catalogue rather than the server: the store loses power to
  // the server without losing it to the phones, and lookup has to survive that.
  const fetchParts = useCallback(async (q: string): Promise<any[]> => {
    const trimmed = q.trim();
    if (!trimmed) return [];
    return searchCatalog(trimmed);
  }, []);

  // ── Debounced autocomplete ────────────────────────────────────────────────
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const list = await fetchParts(query);
        setResults(list);
      } catch (err: any) {
        setSearchError(err.response?.data?.message || 'Search failed. Try again.');
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, fetchParts]);

  // ── Camera permission & control ────────────────────────────────────────────────────────
  const openScanner = () => {
    setIsScannerOpen(true);
  };

  const closeScanner = useCallback(() => {
    setIsScannerOpen(false);
  }, []);

  // ── Barcode scan → exact lookup → immediate navigate ─────────────────────
  const handleResolveBarcode = async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return { status: 'not_found' as const };
    try {
      // 1. Exact barcode hit
      const exact = await lookupBarcode(trimmed);
      if (exact) {
        startAdHocCount(exact);
        router.push('/count');
        return { status: 'success' as const };
      }

      // 2. Fall back to searching the code as text -- some codes are printed
      // on the box but recorded as a part number rather than a barcode.
      const list = await fetchParts(trimmed);
      if (list.length > 0) {
        const match = list.find((p: any) => p.barcodes?.includes(trimmed)) ?? list[0];
        startAdHocCount(match);
        router.push('/count');
        return { status: 'success' as const };
      }
    } catch (err) {
      console.error('Barcode lookup error:', err);
      return { status: 'error' as const, message: 'Lookup failed' };
    }

    // 3. Not found - will trigger the 404 screen in PremiumScanner
    return { status: 'not_found' as const };
  };

  const handleBarcodeScanned = (barcode: string) => {
    closeScanner();
  };

  const handleLinkBarcode = (barcode: string) => {
    setPendingBarcodeToLink(barcode);
  };

  // ── Part selection from list ──────────────────────────────────────────────
  const handleSelectPart = (part: any) => {
    startAdHocCount(part, pendingBarcodeToLink);
    setPendingBarcodeToLink(null);
    router.push('/count');
  };

  // ── Render helpers ───────────────────────────────────────────────────────────
  const renderResult = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.resultCard} onPress={() => handleSelectPart(item)} activeOpacity={0.7}>
      <View style={styles.resultIconWrap}>
        <Ionicons name="cube-outline" size={22} color={theme.primary} />
      </View>
      <View style={styles.resultInfo}>
        <Text style={styles.resultName} numberOfLines={1}>
          {item.display_name ?? item.name ?? item.part_id}
        </Text>
        <Text style={styles.resultSku} numberOfLines={1}>
          SKU: {item.internal_sku || item.sku || '—'}
          {item.barcodes && item.barcodes.length > 0 ? `  ·  Barcode: ${item.barcodes[0]}${item.barcodes.length > 1 ? ` (+${item.barcodes.length - 1} more)` : ''}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </TouchableOpacity>
  );

  return (
    <Screen>
      {/* Scan-resolving overlay */}
      {isScanResolving && (
        <View style={styles.scanResolveOverlay}>
          <ActivityIndicator size="large" color={theme.primaryText} />
          <Text style={styles.scanResolveText}>Looking up barcode…</Text>
        </View>
      )}

      <AppHeader title="Log Unassigned Find" subtitle="Ad-hoc cycle count" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Search bar + scan toggle */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            {isSearching
              ? <ActivityIndicator size="small" color={theme.textMuted} style={styles.searchIcon} />
              : <Ionicons name="search-outline" size={18} color={theme.textMuted} style={styles.searchIcon} />
            }
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, SKU, barcode…"
              placeholderTextColor={theme.textMuted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
                <Ionicons name="close-circle" size={18} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.scanBtn} onPress={openScanner} activeOpacity={0.8}>
            <Ionicons name="barcode-outline" size={22} color={theme.primaryText} />
          </TouchableOpacity>
        </View>

        {/* Staged barcode banner */}
        {pendingBarcodeToLink && (
          <View style={styles.stagedBanner}>
            <Text style={styles.stagedBannerText}>
              Staged barcode to link: {pendingBarcodeToLink}
            </Text>
            <TouchableOpacity onPress={() => setPendingBarcodeToLink(null)} accessibilityLabel="Clear staged barcode">
              <Ionicons name="close" size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Inline hint */}
        <Text style={styles.hintText}>
          Type to search, or tap the scan button to read a barcode
        </Text>

        {/* Error banner */}
        {searchError && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
            <Text style={styles.errorText}>{searchError}</Text>
          </View>
        )}

        {/* Autocomplete results */}
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.part_id ?? item.id)}
          renderItem={renderResult}
          contentContainerStyle={styles.resultsList}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            !isSearching && query.trim().length > 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search" size={40} color={theme.borderStrong} />
                <Text style={styles.emptyText}>No parts found for "{query}"</Text>
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>

      {/* Barcode Scanner Modal */}
      <PremiumScanner
        visible={isScannerOpen}
        onClose={closeScanner}
        onBarcodeScanned={handleBarcodeScanned}
        onResolveBarcode={handleResolveBarcode}
        onLinkBarcode={handleLinkBarcode}
        title="Scan Barcode"
        autoCloseOnSuccess={true}
      />
    </Screen>
  );
}

/**
 * Derived from the active theme so the screen follows light and dark.
 * Colours that belong to the camera overlay stay literal: that surface sits
 * over a live preview and is dark regardless of the app theme.
 */
const makeStyles = (theme: ThemeColors) => StyleSheet.create({

  scanResolveOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  scanResolveText: { color: '#fff', fontSize: 15 },


  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: theme.text, height: '100%' },
  scanBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },

  hintText: {
    fontSize: 11,
    color: theme.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.dangerSoft,
    marginHorizontal: 16,
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  errorText: { color: theme.danger, fontSize: 13, flex: 1 },

  resultsList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  resultIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: theme.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '600', color: theme.text },
  resultSku: { fontSize: 12, color: theme.textMuted, marginTop: 2 },

  emptyState: { alignItems: 'center', marginTop: 48, gap: 12 },
  emptyText: { fontSize: 14, color: theme.textMuted, textAlign: 'center' },

  stagedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    backgroundColor: theme.primarySoft,
    borderLeftWidth: 4,
    borderLeftColor: theme.primary,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  stagedBannerText: {
    flex: 1,
    color: theme.primary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },

  // Camera modal
});

/** Reachable by deep link, so gated here rather than only on the dashboard. */
export default function UnassignedSearchScreen() {
  return (
    <RequirePermission permission="cycle_count:execute" title="Log unassigned">
      <UnassignedSearchScreenInner />
    </RequirePermission>
  );
}
