import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner, useCameraFormat } from 'react-native-vision-camera';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { GlassView } from 'expo-glass-effect';
import { SymbolView } from 'expo-symbols';
import * as haptics from '@/utils/haptics';
import {
  createPipelineRefs,
  runConsensus,
  isValidEanChecksum,
  isInROI,
  type ScannerPipelineRefs,
  FRAME_INTERVAL_MS,
} from '@/utils/scannerPipeline';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const VIEWPORT_WIDTH = SCREEN_WIDTH * 0.85;
const VIEWPORT_HEIGHT = 140;

interface PremiumScannerProps {
  visible: boolean;
  onClose: () => void;
  onBarcodeScanned: (barcode: string) => void;
  onResolveBarcode?: (
    barcode: string
  ) => Promise<{ status: 'success' | 'not_found' | 'error'; message?: string }>;
  title?: string;
  autoCloseOnSuccess?: boolean;
}

export default function PremiumScanner({
  visible,
  onClose,
  onBarcodeScanned,
  onResolveBarcode,
  title = 'Premium Scanner',
  autoCloseOnSuccess = true,
}: PremiumScannerProps) {
  const theme = useTheme();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [{ fps: 30 }]);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [torch, setTorch] = useState<'off' | 'on'>('off');
  const [consensusCount, setConsensusCount] = useState(0);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<'idle' | 'confirm' | '404' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const pipelineRef = useRef<ScannerPipelineRefs>(createPipelineRefs());
  const lastFrameTsRef = useRef<number>(0);

  // Animation values
  const laserY = useSharedValue(0);
  const cornerScale = useSharedValue(1);
  const successFlash = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setIsCameraActive(true);
      resetScannerState();
    } else {
      setIsCameraActive(false);
    }
  }, [visible]);

  useEffect(() => {
    if (visible && isCameraActive) {
      laserY.value = withRepeat(
        withTiming(VIEWPORT_HEIGHT - 6, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      cornerScale.value = withRepeat(
        withTiming(1.05, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      laserY.value = 0;
      cornerScale.value = 1;
    }
  }, [visible, isCameraActive]);

  const resetScannerState = () => {
    setConsensusCount(0);
    pipelineRef.current = createPipelineRefs();
    setScannedBarcode(null);
    setDrawerState('idle');
    setErrorMessage(null);
    setIsResolving(false);
    setIsCameraActive(true);
    lastFrameTsRef.current = 0;
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'code-128', 'qr', 'code-39'],
    onCodeScanned: (codes, frame) => {
      if (codes.length === 0 || !isCameraActive || isResolving || scannedBarcode) return;

      // Tier A: Frame rate budgeting (33ms interval)
      const now = Date.now();
      if (now - lastFrameTsRef.current < FRAME_INTERVAL_MS) return;
      lastFrameTsRef.current = now;

      const code = codes[0];
      const value = code.value;
      if (!value) return;

      // Tier B: Viewport ROI bounding verification
      if (!isInROI(code, frame?.width ?? 0, frame?.height ?? 0)) return;

      // EAN checksum validation
      if (/^\d{12,13}$/.test(value) && !isValidEanChecksum(value)) {
        haptics.error();
        setErrorMessage('Invalid EAN/UPC Checksum');
        setDrawerState('error');
        setIsCameraActive(false);
        return;
      }

      // Tier C: Sliding consensus evaluation
      const consensus = runConsensus(pipelineRef.current, value);
      setConsensusCount(pipelineRef.current.window.length);

      if (consensus) {
        setIsCameraActive(false);
        setIsResolving(true);
        setScannedBarcode(consensus);

        // Flash and haptic feedback
        successFlash.value = 1;
        successFlash.value = withTiming(0, { duration: 300 });
        haptics.success();

        if (onResolveBarcode) {
          onResolveBarcode(consensus)
            .then((result) => {
              setIsResolving(false);
              if (result.status === 'success') {
                onBarcodeScanned(consensus);
                if (autoCloseOnSuccess) {
                  onClose();
                } else {
                  resetScannerState();
                }
              } else if (result.status === 'not_found') {
                haptics.error();
                setDrawerState('404');
              } else {
                haptics.error();
                setErrorMessage(result.message || 'Error checking barcode');
                setDrawerState('error');
              }
            })
            .catch((err) => {
              setIsResolving(false);
              haptics.error();
              setErrorMessage(err.message || 'Error checking barcode');
              setDrawerState('error');
            });
        } else {
          // Default confirm/accept drawer state
          setIsResolving(false);
          setDrawerState('confirm');
        }
      }
    },
  });

  const handleAccept = () => {
    if (scannedBarcode) {
      onBarcodeScanned(scannedBarcode);
      if (autoCloseOnSuccess) {
        onClose();
      } else {
        resetScannerState();
      }
    }
  };

  const handleRetake = () => {
    haptics.tap();
    resetScannerState();
  };

  const handleClose = () => {
    haptics.tap();
    onClose();
  };

  const handleToggleTorch = () => {
    haptics.tap();
    setTorch((prev) => (prev === 'on' ? 'off' : 'on'));
  };

  // Reanimated style bindings
  const laserAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: laserY.value }],
  }));

  const cornerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cornerScale.value }],
  }));

  const flashAnimStyle = useAnimatedStyle(() => ({
    opacity: successFlash.value,
  }));

  const isDark = theme.background === '#000000';

  const containerStyle = [
    styles.drawer,
    Platform.select({
      ios: {},
      default: {
        backgroundColor: isDark ? 'rgba(33, 34, 37, 0.95)' : 'rgba(240, 240, 243, 0.95)',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
      },
    }),
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {device && (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            format={format}
            isActive={isCameraActive}
            torch={device.hasTorch && torch === 'on' ? 'on' : 'off'}
            codeScanner={codeScanner}
            fps={30}
            zoom={Math.min(Math.max(1.8, device.minZoom ?? 1), device.maxZoom ?? 1.8)}
            exposure={-1}
            enableZoomGesture={true}
          />
        )}

        {/* Success Screen Flash */}
        <Animated.View style={[styles.flashOverlay, flashAnimStyle]} pointerEvents="none" />

        {/* Top HUD Float bar */}
        <GlassView style={styles.hudTop}>
          <TouchableOpacity style={styles.hudButton} onPress={handleClose}>
            <SymbolView
              name={{ ios: 'chevron.backward.circle.fill', android: 'arrow_back', web: 'arrow_back' }}
              tintColor="#fff"
              size={28}
            />
          </TouchableOpacity>
          <Text style={styles.hudTitle}>{title}</Text>
          <TouchableOpacity style={styles.hudButton} onPress={handleToggleTorch}>
            <SymbolView
              name={{
                ios: torch === 'on' ? 'bolt.circle.fill' : 'bolt.slash.circle.fill',
                android: torch === 'on' ? 'flash_on' : 'flash_off',
                web: torch === 'on' ? 'flash_on' : 'flash_off',
              }}
              tintColor={torch === 'on' ? '#F59E0B' : '#fff'}
              size={28}
            />
          </TouchableOpacity>
        </GlassView>

        {/* Scanning ROI Cutout */}
        <View style={styles.roiContainer} pointerEvents="none">
          <Animated.View
            style={[
              styles.viewfinder,
              cornerAnimStyle,
              drawerState === 'error' && styles.viewfinderError,
              scannedBarcode !== null && styles.viewfinderSuccess,
            ]}>
            {/* Viewfinder Corners */}
            <View style={[styles.corner, styles.topLeftCorner, drawerState === 'error' && styles.cornerError, scannedBarcode !== null && styles.cornerSuccess]} />
            <View style={[styles.corner, styles.topRightCorner, drawerState === 'error' && styles.cornerError, scannedBarcode !== null && styles.cornerSuccess]} />
            <View style={[styles.corner, styles.bottomLeftCorner, drawerState === 'error' && styles.cornerError, scannedBarcode !== null && styles.cornerSuccess]} />
            <View style={[styles.corner, styles.bottomRightCorner, drawerState === 'error' && styles.cornerError, scannedBarcode !== null && styles.cornerSuccess]} />
            <Animated.View
              style={[
                styles.laser,
                laserAnimStyle,
                drawerState === 'error' && styles.laserError,
                scannedBarcode !== null && styles.laserSuccess,
              ]}
            />
          </Animated.View>
        </View>

        {/* Dynamic Glass Drawer */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}>
          <GlassView style={containerStyle}>
            {drawerState === 'idle' && (
              <View style={styles.drawerContent}>
                {isResolving ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={styles.instructions}>Resolving barcode...</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.instructions}>Align barcode within the frame</Text>
                    {/* Consensus Progress Dots */}
                    <View style={styles.consensusContainer}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.consensusDot,
                            i < consensusCount && styles.consensusDotActive,
                          ]}
                        />
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            {drawerState === 'confirm' && (
              <View style={styles.drawerContent}>
                <Text style={styles.scannedTitle}>Barcode Acquired</Text>
                <Text style={styles.scannedValue}>{scannedBarcode}</Text>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={[styles.actionBtn, styles.btnCancel]} onPress={handleRetake}>
                    <Text style={styles.btnCancelText}>Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.btnConfirm]} onPress={handleAccept}>
                    <Text style={styles.btnConfirmText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {drawerState === '404' && (
              <View style={styles.drawerContent}>
                <View style={styles.errorHeader}>
                  <SymbolView
                    name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                    tintColor="#EF4444"
                    size={24}
                  />
                  <Text style={styles.errorTitle}>SKU Not Found (404)</Text>
                </View>
                <Text style={styles.errorDesc}>
                  No item in database has barcode <Text style={{ fontWeight: 'bold' }}>{scannedBarcode}</Text>.
                </Text>
                <View style={styles.actionsColumn}>
                  <TouchableOpacity
                    style={[styles.actionBtnBlock, styles.btnConfirm]}
                    onPress={() => {
                      haptics.tap();
                      onClose();
                      // Auto-redirect instructions
                      setTimeout(() => {
                        alert(
                          'To assign this barcode:\n1. Search for the item by name or SKU.\n2. Select it.\n3. Scan the barcode on the count screen.'
                        );
                      }, 200);
                    }}>
                    <Text style={styles.btnConfirmText}>Link to Existing Part</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtnBlock, styles.btnCancel]} onPress={handleRetake}>
                    <Text style={styles.btnCancelText}>Retry Scanning</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {drawerState === 'error' && (
              <View style={styles.drawerContent}>
                <View style={styles.errorHeader}>
                  <SymbolView
                    name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
                    tintColor="#EF4444"
                    size={24}
                  />
                  <Text style={styles.errorTitle}>Scan Error</Text>
                </View>
                <Text style={styles.errorDesc}>{errorMessage || 'An unknown error occurred during scanning.'}</Text>
                <TouchableOpacity style={[styles.actionBtnBlock, styles.btnCancel]} onPress={handleRetake}>
                  <Text style={styles.btnCancelText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            )}
          </GlassView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 999,
  },
  hudTop: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 28,
    left: 16,
    right: 16,
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 10,
    ...Platform.select({
      default: {
        backgroundColor: 'rgba(21, 22, 25, 0.85)',
      },
    }),
  },
  hudButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudTitle: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  roiContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
  },
  viewfinderSuccess: {
    borderColor: '#10B981',
  },
  viewfinderError: {
    borderColor: '#EF4444',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#10B981',
  },
  cornerSuccess: {
    borderColor: '#10B981',
  },
  cornerError: {
    borderColor: '#EF4444',
  },
  topLeftCorner: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  topRightCorner: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  bottomLeftCorner: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  bottomRightCorner: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  laser: {
    width: '100%',
    height: 4,
    backgroundColor: '#10B981',
    opacity: 0.8,
  },
  laserSuccess: {
    backgroundColor: '#10B981',
  },
  laserError: {
    backgroundColor: '#EF4444',
  },
  keyboardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  drawer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: Spacing.four,
    paddingBottom: Platform.OS === 'ios' ? 44 : 28,
    ...Platform.select({
      ios: {
        backgroundColor: 'transparent',
      },
    }),
  },
  drawerContent: {
    alignItems: 'center',
    width: '100%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  instructions: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.9,
    textAlign: 'center',
  },
  consensusContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: Spacing.three,
    justifyContent: 'center',
  },
  consensusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  consensusDotActive: {
    backgroundColor: '#10B981',
  },
  scannedTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.7,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scannedValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginVertical: Spacing.two,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnBlock: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsColumn: {
    width: '100%',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  btnCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  btnCancelText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  btnConfirm: {
    backgroundColor: '#10B981',
  },
  btnConfirmText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.two,
  },
  errorTitle: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  errorDesc: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.9,
    lineHeight: 20,
    marginBottom: Spacing.two,
  },
});
