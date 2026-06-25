import React, { useState, useCallback, useRef } from 'react';
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
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';

export default function UnassignedSearchScreen() {
  const router = useRouter();
  const { startAdHocCount } = useCycleCountStore();

  // ── Search state ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Camera state ────────────────────────────────────────────────────────────
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const scanLockRef = useRef(false);

  const device = useCameraDevice('back');

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

  const closeScanner = () => {
    setIsScannerOpen(false);
    setIsCameraActive(false);
    setIsTorchOn(false);
    scanLockRef.current = false;
  };

  // ── Barcode scan handler (VisionCamera v4) ──────────────────────────────────
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

        // Search the scanned barcode immediately
        closeScanner();
        await performSearch(value);
        setQuery(value);
      },
      [isCameraActive] // eslint-disable-line react-hooks/exhaustive-deps
    ),
  });

  // ── Search API ───────────────────────────────────────────────────────────────
  const performSearch = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    Keyboard.dismiss();
    setIsSearching(true);
    setSearchError(null);
    setResults([]);

    try {
      const { data } = await apiClient.get('/inventory/parts/search', {
        params: { q: trimmed },
      });
      setResults(Array.isArray(data) ? data : data?.results ?? []);
    } catch (err: any) {
      setSearchError(err.response?.data?.message || 'Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  // ── Part selection ───────────────────────────────────────────────────────────
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
          {item.display_name ?? item.name ?? item.id}
        </Text>
        <Text style={styles.resultSku} numberOfLines={1}>
          SKU: {item.internal_sku || item.sku || '—'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Unassigned Find</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Search bar + scan toggle */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color="#9ca3af" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, SKU, or ID…"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => performSearch(query)}
            autoCapitalize="none"
            autoCorrect={false}
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

      {/* Search action button */}
      <TouchableOpacity
        style={[styles.searchActionBtn, isSearching && styles.searchActionBtnDisabled]}
        onPress={() => performSearch(query)}
        disabled={isSearching || query.trim().length === 0}
        activeOpacity={0.8}
      >
        {isSearching
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.searchActionBtnText}>Search</Text>
        }
      </TouchableOpacity>

      {/* Error */}
      {searchError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
          <Text style={styles.errorText}>{searchError}</Text>
        </View>
      )}

      {/* Results */}
      <FlatList
        data={results}
        keyExtractor={(item) => String(item.id ?? item.part_id)}
        renderItem={renderResult}
        contentContainerStyle={styles.resultsList}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !isSearching && query.trim() ? (
            <View style={styles.emptyState}>
              <Ionicons name="search" size={40} color="#d1d5db" />
              <Text style={styles.emptyText}>No parts found for "{query}"</Text>
            </View>
          ) : null
        }
      />

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
              <Text style={styles.errorText}>Camera unavailable or permission denied.</Text>
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

  searchActionBtn: {
    marginHorizontal: 16,
    marginTop: 10,
    height: 48,
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchActionBtnDisabled: { backgroundColor: '#93c5fd' },
  searchActionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },

  resultsList: { padding: 16, paddingBottom: 40 },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
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
