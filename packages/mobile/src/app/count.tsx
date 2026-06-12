import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import useCycleCountStore from '../store/useCycleCountStore';
import MobileCounter from '../components/MobileCounter';
import apiClient from '../api/client';

export default function CountScreen() {
  const router = useRouter();
  const { activeBatchData, clearActiveBatch } = useCycleCountStore();
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  // Camera Modal States
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);

  const device = useCameraDevice('back');

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  if (!activeBatchData || activeBatchData.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>No active batch selected.</Text>
      </View>
    );
  }

  const currentLine = activeBatchData[currentLineIndex];

  const handleCodeScanned = (codes: any[]) => {
    if (codes.length > 0 && isCameraActive && !pendingBarcode) {
      const scannedValue = codes[0].value;
      if (scannedValue) {
        console.log(`Scanned barcode: ${scannedValue}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsCameraActive(false);
        setPendingBarcode(scannedValue);
      }
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'code-128', 'qr'],
    onCodeScanned: handleCodeScanned
  });

  const handleSubmitCount = async (countedQty: number) => {
    setIsSubmitting(true);
    try {
      const payload: any = {
        counted_qty: countedQty
      };

      if (scannedBarcode) {
        payload.scanned_barcode = scannedBarcode;
      }

      await apiClient.post(`/inventory/cycle-count/lines/${currentLine.line_id}/submit`, payload);

      setIsSubmitting(false);

      if (currentLineIndex + 1 < activeBatchData.length) {
        setCurrentLineIndex(prev => prev + 1);
        setScannedBarcode(null); // Reset for the next item
      } else {
        // Reached the end
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
    } catch (error: any) {
      setIsSubmitting(false);
      console.error('Submit batch error', error);
      Alert.alert('Error', error.response?.data?.message || 'Failed to submit the item.');
    }
  };

  if (isSubmitting) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={{ marginTop: 16 }}>Submitting batch...</Text>
      </View>
    );
  }

  const needsBarcode = !currentLine.barcode && !scannedBarcode;

  const openCameraModal = () => {
    setPendingBarcode(null);
    setIsCameraActive(true);
    setIsCameraModalOpen(true);
  };

  const closeCameraModal = () => {
    setIsCameraModalOpen(false);
    setIsCameraActive(false);
    setPendingBarcode(null);
    setIsTorchOn(false);
  };

  const acceptBarcode = () => {
    if (pendingBarcode) {
      setScannedBarcode(pendingBarcode);
      closeCameraModal();
    }
  };

  const retakeBarcode = () => {
    setPendingBarcode(null);
    setIsCameraActive(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.headerZone}>
          <Text style={styles.itemTitle}>{currentLine.display_name}</Text>
          <Text style={styles.itemSubtitle}>Item {currentLineIndex + 1} of {activeBatchData.length}</Text>
          <Text style={styles.itemSubtitle}>Part ID: {currentLine.part_id}</Text>

          <TouchableOpacity
            style={[styles.statusPill, (scannedBarcode || currentLine.barcode) ? styles.statusPillSuccess : styles.statusPillNeutral]}
            onPress={openCameraModal}
            activeOpacity={0.7}
          >
            <Text style={(scannedBarcode || currentLine.barcode) ? styles.statusPillTextSuccess : styles.statusPillTextNeutral}>
              Barcode
            </Text>
          </TouchableOpacity>
        </View>
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
                torch={isTorchOn ? 'on' : 'off'}
              />

              {/* Overlay Viewfinder */}
              <View style={styles.overlay}>
                <View style={styles.overlayTop} />
                <View style={styles.overlayMiddle}>
                  <View style={styles.overlaySide} />
                  <View style={styles.viewfinderCutout} />
                  <View style={styles.overlaySide} />
                </View>
                <View style={styles.overlayBottom} />
              </View>

              {/* Camera Header Actions */}
              <View style={styles.cameraHeader}>
                <TouchableOpacity style={styles.iconButton} onPress={closeCameraModal}>
                  <Ionicons name="close" size={30} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton} onPress={() => setIsTorchOn(!isTorchOn)}>
                  <Ionicons name={isTorchOn ? "flash" : "flash-off"} size={26} color="#fff" />
                </TouchableOpacity>
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
  topSection: {
    alignItems: 'center',
    flex: 1,
    width: '100%',
  },
  headerZone: {
    width: '100%',
    padding: 20,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  itemSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  statusPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  statusPillNeutral: {
    backgroundColor: 'gray',
  },
  statusPillSuccess: {
    backgroundColor: 'green',
  },
  statusPillTextNeutral: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  statusPillTextSuccess: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  counterZone: {
    justifyContent: 'flex-end',
    paddingBottom: 20,
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
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayMiddle: {
    height: 200,
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewfinderCutout: {
    width: '80%',
    height: '100%',
    borderWidth: 2,
    borderColor: '#3b82f6',
    backgroundColor: 'transparent',
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
