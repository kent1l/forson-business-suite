import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView, Modal, TouchableOpacity, Dimensions, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import useCycleCountStore from '../store/useCycleCountStore';
import MobileCounter from '../components/MobileCounter';
import apiClient from '../api/client';
import {
  FRAME_INTERVAL_MS,
  ROI_HALF_WIDTH,
  createPipelineRefs,
  isValidEanChecksum,
  runConsensus,
  type ScannerPipelineRefs,
} from '../utils/scannerPipeline';

// ROI viewfinder guard: rejects codes whose horizontal centre falls outside the
// central 40% band (±ROI_HALF_WIDTH from mid) — Tier B of the pipeline.
const isInROI = (code: any, frameWidth: number): boolean => {
  if (!code.bounds || frameWidth === 0) return true;
  const { minX, maxX } = code.bounds as { minX: number; maxX: number };
  const normMidX = (minX + (maxX - minX) / 2) / frameWidth;
  return Math.abs(normMidX - 0.5) <= ROI_HALF_WIDTH;
};

export default function CountScreen() {
  const router = useRouter();
  const {
    activeBatchData,
    clearActiveBatch,
    isAdHocMode,
    currentAdHocItem,
    submitAdHocCount,
    clearAdHocMode,
    activeLineId,
  } = useCycleCountStore();
  const [currentLineIndex, setCurrentLineIndex] = useState(() => {
    if (activeBatchData && activeLineId) {
      const idx = activeBatchData.findIndex((line: any) => line.line_id === activeLineId);
      return idx !== -1 ? idx : 0;
    }
    return 0;
  });
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  // Camera Modal States
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const pipelineRef = useRef<ScannerPipelineRefs>(createPipelineRefs());
  const lastFrameTsRef = useRef<number>(0);

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

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Guard: in ad-hoc mode we need currentAdHocItem; in batch mode we need activeBatchData
  if (!isAdHocMode && (!activeBatchData || activeBatchData.length === 0)) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>No active batch selected.</Text>
      </View>
    );
  }
  if (isAdHocMode && !currentAdHocItem) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>No item selected for ad-hoc count.</Text>
      </View>
    );
  }

  // currentLine is the unified data shape for the UI regardless of mode
  const currentLine = isAdHocMode
    ? {
        display_name: currentAdHocItem!.display_name ?? currentAdHocItem!.name,
        internal_sku: currentAdHocItem!.internal_sku ?? currentAdHocItem!.sku,
        part_id: currentAdHocItem!.id ?? currentAdHocItem!.part_id,
        barcodes: currentAdHocItem!.barcodes ?? [],
        expected_qty: currentAdHocItem!.expected_qty ?? null,
      }
    : activeBatchData![currentLineIndex];

  const handleCodeScanned = useCallback((codes: any[], frame: any) => {
    // Gate: must have a code, camera must be live, no pending confirmation
    if (codes.length === 0 || !isCameraActive || pendingBarcode) return;

    // ── Tier A: Time-gated frame skip (33 ms @ 30 FPS) ───────────────────────
    const now = Date.now();
    if (now - lastFrameTsRef.current < FRAME_INTERVAL_MS) return;
    lastFrameTsRef.current = now;

    const code = codes[0];
    const scannedValue: string | undefined = code.value;
    if (!scannedValue) return;

    // ── Tier B: ROI viewport mask (central 40% horizontal band) ──────────────
    if (!isInROI(code, frame?.width ?? 0)) return;

    // EAN/UPC checksum pre-filter
    if (/^\d{12,13}$/.test(scannedValue) && !isValidEanChecksum(scannedValue)) {
      return;
    }

    // ── Tier C: Sliding mode consensus evaluation ─────────────────────────────
    const consensus = runConsensus(pipelineRef.current, scannedValue);
    if (!consensus) return;

    // Consensus reached — fire haptic and surface to UI
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsCameraActive(false);
    setPendingBarcode(consensus);
  }, [isCameraActive, pendingBarcode]);

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'code-128', 'qr', 'code-39'],
    onCodeScanned: handleCodeScanned,
  });

  const handleSubmitCount = async (countedQty: number) => {
    setIsSubmitting(true);
    try {
      if (isAdHocMode) {
        // ── Ad-hoc path ──────────────────────────────────────────────────────
        await submitAdHocCount(countedQty);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        // Delay clearAdHocMode slightly to prevent state tearing/crashes during unmount
        setTimeout(() => {
          clearAdHocMode();
        }, 100);
        
        router.replace('/unassigned-search');
      } else {
        // ── Assigned batch path ──────────────────────────────────────────────
        const payload: any = { counted_qty: countedQty };
        if (scannedBarcode) payload.scanned_barcode = scannedBarcode;

        await apiClient.post(`/inventory/cycle-count/lines/${currentLine.line_id}/submit`, payload);
        setIsSubmitting(false);

        if (currentLineIndex + 1 < activeBatchData!.length) {
          setCurrentLineIndex((prev: number) => prev + 1);
          setScannedBarcode(null);
        } else {
          Alert.alert('Batch Complete', 'All items submitted successfully.', [
            {
              text: 'OK',
              onPress: () => {
                clearActiveBatch();
                router.replace('/');
              },
            },
          ]);
        }
      }
    } catch (error: any) {
      setIsSubmitting(false);
      console.error('Submit count error', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to submit the item.');
    }
  };

  if (isSubmitting) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={{ marginTop: 16 }}>
          {isAdHocMode ? 'Submitting find...' : 'Submitting batch...'}
        </Text>
      </View>
    );
  }

  const needsBarcode = !(currentLine.barcodes && currentLine.barcodes.length > 0) && !scannedBarcode;
  const hasBarcode: boolean = Boolean(currentLine.barcodes && currentLine.barcodes.length > 0) || Boolean(scannedBarcode);

  const openCameraModal = () => {
    setPendingBarcode(null);
    pipelineRef.current = createPipelineRefs();
    lastFrameTsRef.current = 0;
    setIsCameraActive(true);
    setIsCameraModalOpen(true);
  };

  const closeCameraModal = () => {
    setIsCameraModalOpen(false);
    setIsCameraActive(false);
    setPendingBarcode(null);
    pipelineRef.current = createPipelineRefs();
    lastFrameTsRef.current = 0;
  };

  const acceptBarcode = () => {
    if (pendingBarcode) {
      if (currentLine.barcodes && currentLine.barcodes.includes(pendingBarcode)) {
        setScannedBarcode(pendingBarcode);
        closeCameraModal();
      } else {
        Alert.alert(
          'Link Barcode',
          `Do you want to link the scanned barcode (${pendingBarcode}) to this item?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Yes, Link It', 
              onPress: () => {
                setScannedBarcode(pendingBarcode);
                closeCameraModal();
              }
            }
          ]
        );
      }
    }
  };

  const retakeBarcode = () => {
    setPendingBarcode(null);
    pipelineRef.current = createPipelineRefs();
    lastFrameTsRef.current = 0;
    setIsCameraActive(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerStrip}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Active Count</Text>
        </View>

        <TouchableOpacity
          onPress={openCameraModal}
          activeOpacity={0.75}
          style={[
            styles.barcodePill,
            hasBarcode ? styles.barcodePillSuccess : styles.barcodePillNeutral
          ]}
        >
          <Text style={styles.barcodePillText}>Barcode</Text>
        </TouchableOpacity>
      </View>

      {/* Item details card (item_text_zone) */}
      <View style={styles.itemTextZone}>
        <Text
          style={styles.itemTitle}
          adjustsFontSizeToFit
          numberOfLines={3}
          minimumFontScale={0.85}
        >
          {currentLine.display_name ?? currentLine.part_id}
        </Text>
        <Text
          style={styles.itemSubtitle}
          numberOfLines={1}
        >
          {currentLine.internal_sku || currentLine.sku || currentLine.part_id}
        </Text>
      </View>

      {/* Progress container */}
      <View style={styles.progressContainer}>
        <View style={styles.metaRow}>
          {isAdHocMode ? (
            <Text style={[styles.progressText, { color: '#f59e0b', fontWeight: '600' }]}>
              ⚠ Unassigned Find
            </Text>
          ) : (
            <Text style={styles.progressText}>
              Item {currentLineIndex + 1} of {activeBatchData!.length}
            </Text>
          )}
        </View>

        {!isAdHocMode && (
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${((currentLineIndex + 1) / activeBatchData!.length) * 100}%` },
              ]}
            />
          </View>
        )}
      </View>

      <View style={styles.counterZone}>
        <MobileCounter
          initialQuantity={0}
          onSubmit={handleSubmitCount}
        />
      </View>

      {/* Camera Modal */}
      <Modal visible={isCameraModalOpen} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          {hasPermission && device ? (
            <View style={styles.cameraWrapper}>
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isCameraActive}
                codeScanner={codeScanner as any}
                fps={30}
                zoom={1.8}
                exposure={-1}
                torch="on"
                enableZoomGesture={true}
              />

              {/* Overlay Viewfinder */}
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

              {/* Camera Header Actions */}
              <View style={styles.cameraHeader}>
                <TouchableOpacity style={styles.iconButton} onPress={closeCameraModal}>
                  <Ionicons name="close" size={30} color="#fff" />
                </TouchableOpacity>
                <View style={[styles.iconButton, { backgroundColor: 'rgba(251,191,36,0.35)' }]}>
                  <Ionicons name="flash" size={26} color="#fbbf24" />
                </View>
              </View>

              {/* Bottom Sheet for pending barcode */}
              {pendingBarcode && (
                <View style={styles.bottomSheet}>
                  <Text style={styles.bottomSheetTitle}>Barcode Scanned</Text>
                  <Text style={styles.bottomSheetValue}>{pendingBarcode}</Text>

                  <View style={styles.bottomSheetActions}>
                    <TouchableOpacity style={[styles.bottomSheetBtn, styles.btnRetake]} onPress={retakeBarcode}>
                      <Text style={styles.btnRetakeText}>[ Retake ]</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.bottomSheetBtn, styles.btnAccept]} onPress={acceptBarcode}>
                      <Text style={styles.btnAcceptText}>[ Accept ]</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.centerContainer}>
              <Text style={styles.errorText}>Camera permission not granted.</Text>
              <TouchableOpacity style={{marginTop: 20}} onPress={closeCameraModal}>
                <Text style={{color: '#3b82f6', fontSize: 18}}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    backgroundColor: '#fff',
  },

  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: 'red',
  },
  headerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
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
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  barcodePill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  barcodePillSuccess: {
    backgroundColor: '#16a34a',
  },
  barcodePillNeutral: {
    backgroundColor: '#9ca3af',
  },
  barcodePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  itemTextZone: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 16,
  },
  itemTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  itemSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
    textAlign: 'center',
  },
  progressContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  metaRow: {
    marginBottom: 6,
  },
  progressText: {
    fontSize: 12,
    color: '#6b7280',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: '#3b82f6',
    borderRadius: 2,
  },
  counterZone: {
    backgroundColor: '#fff',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraWrapper: {
    flex: 1,
  },
  cameraHeader: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 5,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
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
  overlayMiddle: {
    height: 200,
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  viewfinderCutout: {
    width: '80%',
    height: '100%',
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
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    zIndex: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  bottomSheetTitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 8,
    textAlign: 'center',
  },
  bottomSheetValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 24,
  },
  bottomSheetActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomSheetBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  btnRetake: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  btnRetakeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4b5563',
  },
  btnAccept: {
    backgroundColor: '#3b82f6',
  },
  btnAcceptText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
});
