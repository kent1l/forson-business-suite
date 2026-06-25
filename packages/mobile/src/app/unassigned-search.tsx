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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';

const DEBOUNCE_MS = 300;

export default function UnassignedSearchScreen() {
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
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanResolving, setIsScanResolving] = useState(false);
  const scanLockRef = useRef(false);

  const device = useCameraDevice('back');

  // ── Core search function (shared by debounce + barcode scan) ─────────────
  const fetchParts = useCallback(async (q: string): Promise<any[]> => {
    const trimmed = q.trim();
    if (!trimmed) return [];
    const { data } = await apiClient.get('/parts', { params: { search: trimmed } });
    // API returns { data: [...] } or an array directly
    const list = Array.isArray(data) ? data : (data?.data ?? data?.results ?? []);
    return list;
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

  // ── Camera permission ────────────────────────────────────────────────────────
  const openScanner = async () => {
    const status = await Camera.requestCameraPermission();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is needed to scan barcodes.');
      return;
    }
    setHasPermission(true);
    scanLockRef.current = false;
    setIsCameraActive(true);
    setIsScannerOpen(true);
  };

  const closeScanner = useCallback(() => {
    setIsScannerOpen(false);
    setIsCameraActive(false);
    setIsTorchOn(false);
    scanLockRef.current = false;
  }, []);

  // ── Barcode scan → exact lookup → immediate navigate ─────────────────────
  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'code-128', 'qr', 'code-39'],
    onCodeScanned: useCallback(
      async (codes: any[]) => {
        if (!isCameraActive || scanLockRef.current || codes.length === 0) return;
        const value = codes[0].value;
        if (!value) return;

        scanLockRef.current = true;
        setIsCameraActive(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsScanResolving(true);
        closeScanner();

        try {
          const list = await fetchParts(value);
          if (list.length === 0) {
            Alert.alert('Not Found', `No part found for barcode "${value}".`);
            setIsScanResolving(false);
            return;
          }
          // Prefer exact barcode match; fall back to top result
          const exactMatch = list.find(
            (p: any) => p.barcode?.toString() === value
          ) ?? list[0];
          startAdHocCount(exactMatch);
          router.push('/count');
        } catch (err: any) {
          Alert.alert('Error', err.response?.data?.message || 'Failed to look up barcode.');
          setIsScanResolving(false);
        }
      },
      [isCameraActive, closeScanner, fetchParts, startAdHocCount, router]
    ),
  });

  // ── Part selection from list ──────────────────────────────────────────────
  const handleSelectPart = (part: any) => {
    startAdHocCount(part);
    router.push('/count');
  };

  // ── Render helpers ───────────────────────────────────────────────────────────
  const renderResult = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.resultCard} onPress={() => handleSelectPart(item)} activeOpacity={0.7}>
      <View style={styles.resultIconWrap}>
        <Ionicons name="cube-outline" size={22} color="#3b82f6" />
      </View>
      <View style={styles.resultInfo}>
        <Text style={styles.resultName} numberOfLines={1}>
          {item.display_name ?? item.name ?? item.part_id}
        </Text>
        <Text style={styles.resultSku} numberOfLines={1}>
          SKU: {item.internal_sku || item.sku || '—'}
          {item.barcode ? `  ·  Barcode: ${item.barcode}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Scan-resolving overlay */}
      {isScanResolving && (
        <View style={styles.scanResolveOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.scanResolveText}>Looking up barcode…</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Unassigned Find</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Search bar + scan toggle */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            {isSearching
              ? <ActivityIndicator size="small" color="#9ca3af" style={styles.searchIcon} />
              : <Ionicons name="search-outline" size={18} color="#9ca3af" style={styles.searchIcon} />
            }
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, SKU, barcode…"
              placeholderTextColor="#9ca3af"
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.scanBtn} onPress={openScanner} activeOpacity={0.8}>
            <Ionicons name="barcode-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Inline hint */}
        <Text style={styles.hintText}>
          Type to search · or tap{' '}
          <Text style={{ color: '#3b82f6' }}>⬛</Text>
          {' '}to scan a barcode
        </Text>

        {/* Error banner */}
        {searchError && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
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
                <Ionicons name="search" size={40} color="#d1d5db" />
                <Text style={styles.emptyText}>No parts found for "{query}"</Text>
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>

      {/* Barcode Scanner Modal */}
      <Modal visible={isScannerOpen} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          {hasPermission && device ? (
            <View style={{ flex: 1 }}>
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isCameraActive}
                codeScanner={codeScanner as any}
                torch={isTorchOn ? 'on' : 'off'}
              />

              {/* Overlay */}
              <View style={styles.overlay} pointerEvents="none">
                <View style={styles.overlayTop} />
                <View style={styles.overlayMiddle}>
                  <View style={styles.overlaySide} />
                  <View style={styles.viewfinderCutout} />
                  <View style={styles.overlaySide} />
                </View>
                <View style={styles.overlayBottom} />
              </View>

              {/* Camera controls */}
              <View style={styles.cameraHeader}>
                <TouchableOpacity style={styles.iconButton} onPress={closeScanner}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.cameraHint}>Align barcode with frame</Text>
                <TouchableOpacity style={styles.iconButton} onPress={() => setIsTorchOn((p) => !p)}>
                  <Ionicons name={isTorchOn ? 'flash' : 'flash-off'} size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.centerContainer}>
              <Text style={{ color: '#dc2626', fontSize: 14 }}>Camera unavailable or permission denied.</Text>
              <TouchableOpacity style={{ marginTop: 20 }} onPress={closeScanner}>
                <Text style={{ color: '#3b82f6', fontSize: 16 }}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  scanResolveOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  scanResolveText: { color: '#fff', fontSize: 15 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },

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
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', height: '100%' },
  scanBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },

  hintText: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    marginHorizontal: 16,
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },

  resultsList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  resultSku: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  emptyState: { alignItems: 'center', marginTop: 48, gap: 12 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },

  // Camera modal
  modalContainer: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 5 },
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  overlayMiddle: { height: 200, flexDirection: 'row' },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)' },
  viewfinderCutout: {
    width: '75%',
    borderWidth: 2,
    borderColor: '#3b82f6',
    backgroundColor: 'transparent',
  },
  cameraHeader: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  cameraHint: { color: '#fff', fontSize: 13, opacity: 0.85 },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
