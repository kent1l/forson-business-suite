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
  Dimensions,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';
import useCycleCountStore from '../store/useCycleCountStore';

const DEBOUNCE_MS = 300;

const isBarcodeInViewfinder = (code: any, frame: any) => {
  if (!code.frame) return true;

  const { x, y, width, height } = code.frame;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const ncx = cx / frame.width;
  const ncy = cy / frame.height;

  const { height: screenHeight } = Dimensions.get('window');
  const verticalTolerance = 120 / screenHeight;
  const horizontalTolerance = 0.43;

  const isRotated = frame.width > frame.height;

  if (isRotated) {
    const dy = Math.abs(ncx - 0.5);
    const dx = Math.abs(ncy - 0.5);
    return dy <= verticalTolerance && dx <= horizontalTolerance;
  } else {
    const dx = Math.abs(ncx - 0.5);
    const dy = Math.abs(ncy - 0.5);
    return dx <= horizontalTolerance && dy <= verticalTolerance;
  }
};

const isValidEanChecksum = (barcode: string): boolean => {
  if (!/^\d{12,13}$/.test(barcode)) return true;
  const digits = barcode.split('').map(Number);
  const checkDigit = digits.pop()!;
  let sum = 0;
  if (digits.length === 12) {
    for (let i = 0; i < 12; i++) {
      sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    }
  } else {
    for (let i = 0; i < 11; i++) {
      sum += digits[i] * (i % 2 === 0 ? 3 : 1);
    }
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
};

export default function UnassignedSearchScreen() {
  const router = useRouter();
  const { startAdHocCount } = useCycleCountStore();

  // ── Search state ────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const scanConsensusRef = useRef<{ value: string; count: number }>({ value: '', count: 0 });
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

  const laserAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCameraActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(laserAnim, {
            toValue: 0,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      laserAnim.setValue(0);
    }
  }, [isCameraActive]);

  const laserTranslateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 190],
  });

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
    scanConsensusRef.current = { value: '', count: 0 };
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
    scanConsensusRef.current = { value: '', count: 0 };
  }, []);

  // ── Barcode scan → exact lookup → immediate navigate ─────────────────────
  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'code-128', 'qr', 'code-39'],
    onCodeScanned: useCallback(
      async (codes: any[], frame: any) => {
        if (!isCameraActive || scanLockRef.current || codes.length === 0) return;
        const code = codes[0];
        const value = code.value;
        if (!value) return;

        if (frame && !isBarcodeInViewfinder(code, frame)) {
          return;
        }

        // Validate EAN/UPC checksums to prevent OCR/scanning noise
        if (/^\d{12,13}$/.test(value) && !isValidEanChecksum(value)) {
          console.warn(`Rejected invalid checksum EAN: ${value}`);
          return;
        }

        // Require multi-frame consensus
        if (scanConsensusRef.current.value === value) {
          scanConsensusRef.current.count += 1;
        } else {
          scanConsensusRef.current.value = value;
          scanConsensusRef.current.count = 1;
        }

        if (scanConsensusRef.current.count < 3) {
          return;
        }

        // Reset consensus on successful match
        scanConsensusRef.current = { value: '', count: 0 };

        scanLockRef.current = true;
        setIsCameraActive(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsScanResolving(true);
        closeScanner();

        try {
          const list = await fetchParts(value);
          if (list.length === 0) {
            Alert.alert(
              'Barcode Not Found',
              `No part found for barcode "${value}". What would you like to do?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Assign to Existing', onPress: () => {
                   Alert.alert('Instructions', 'Search for the item by name or SKU, select it, then scan this barcode on the count screen to link it.');
                }},
                { text: 'Create New Item', onPress: () => {
                   Alert.alert('Notice', 'Please use the Web Portal to create new items.');
                }}
              ]
            );
            setIsScanResolving(false);
            return;
          }
          // Prefer exact barcode match; fall back to top result
          const exactMatch = list.find(
            (p: any) => p.barcodes && p.barcodes.includes(value)
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
          {item.barcodes && item.barcodes.length > 0 ? `  ·  Barcode: ${item.barcodes[0]}${item.barcodes.length > 1 ? ` (+${item.barcodes.length - 1} more)` : ''}` : ''}
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
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Log Unassigned Find</Text>
        </View>
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
                zoom={device.neutralZoom ? device.neutralZoom * 1.5 : 1.5}
                enableZoomGesture={true}
              />

              {/* Overlay */}
              <View style={styles.overlay} pointerEvents="none">
                <View style={styles.overlayTop} />
                <View style={styles.overlayMiddle}>
                  <View style={styles.overlaySide} />
                  <View style={styles.viewfinderCutout}>
                    <View style={[styles.corner, styles.topLeftCorner]} />
                    <View style={[styles.corner, styles.topRightCorner]} />
                    <View style={[styles.corner, styles.bottomLeftCorner]} />
                    <View style={[styles.corner, styles.bottomRightCorner]} />
                    <Animated.View style={[styles.laser, { transform: [{ translateY: laserTranslateY }] }]} />
                  </View>
                  <View style={styles.overlaySide} />
                </View>
                <View style={styles.overlayBottom}>
                  <Text style={styles.scanInstruction}>Align barcode within the frame</Text>
                </View>
              </View>

              {/* Camera controls */}
              <View style={styles.cameraHeader}>
                <TouchableOpacity style={styles.iconButton} onPress={closeScanner}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
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
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  overlayTop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    paddingTop: 24,
  },
  scanInstruction: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  overlayMiddle: { height: 200, flexDirection: 'row' },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  viewfinderCutout: {
    width: '75%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 16,
    backgroundColor: 'transparent',
    position: 'relative',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    borderColor: '#06b6d4',
    width: 24,
    height: 24,
  },
  topLeftCorner: {
    top: -2,
    left: -2,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderTopLeftRadius: 12,
  },
  topRightCorner: {
    top: -2,
    right: -2,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderTopRightRadius: 12,
  },
  bottomLeftCorner: {
    bottom: -2,
    left: -2,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderBottomLeftRadius: 12,
  },
  bottomRightCorner: {
    bottom: -2,
    right: -2,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 12,
  },
  laser: {
    position: 'absolute',
    left: '5%',
    right: '5%',
    height: 2,
    backgroundColor: '#06b6d4',
    shadowColor: '#06b6d4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 5,
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
