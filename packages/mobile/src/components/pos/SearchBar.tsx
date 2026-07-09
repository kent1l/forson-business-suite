import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Text,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Camera, useCameraDevice, useCodeScanner, useCameraFormat } from 'react-native-vision-camera';
import {
  createPipelineRefs,
  FRAME_INTERVAL_MS,
  isValidEanChecksum,
  runConsensus,
  type ScannerPipelineRefs,
} from '@/utils/scannerPipeline';
import * as haptics from '@/utils/haptics';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onScanResult: (barcode: string) => void;
  searchInputRef?: React.RefObject<TextInput>;
}

export default function SearchBar({ value, onChangeText, onScanResult, searchInputRef }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const pipelineRef = useRef<ScannerPipelineRefs>(createPipelineRefs());
  const lastFrameTsRef = useRef<number>(0);
  const scanLockRef = useRef(false);

  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [{ fps: 30 }]);

  const openScanner = useCallback(async () => {
    const status = await Camera.requestCameraPermission();
    setHasPermission(status === 'granted');
    if (status === 'granted') {
      pipelineRef.current = createPipelineRefs();
      lastFrameTsRef.current = 0;
      scanLockRef.current = false;
      setScannerOpen(true);
      setIsCameraActive(true);
    }
  }, []);

  const closeScanner = useCallback(() => {
    setIsCameraActive(false);
    setScannerOpen(false);
    scanLockRef.current = false;
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr', 'ean-13', 'ean-8', 'code-128', 'code-39', 'upc-a', 'upc-e'],
    onCodeScanned: (codes, frame) => {
      if (scanLockRef.current) return;
      const now = Date.now();
      if (now - lastFrameTsRef.current < FRAME_INTERVAL_MS) return;
      lastFrameTsRef.current = now;

      for (const code of codes) {
        if (!code.value) continue;
        if (!isValidEanChecksum(code.value)) continue;
        const consensus = runConsensus(pipelineRef.current, code.value);
        if (consensus) {
          scanLockRef.current = true;
          haptics.success();
          closeScanner();
          onScanResult(consensus);
          return;
        }
      }
    },
  });

  return (
    <>
      <View style={[styles.container, isDark && styles.containerDark]}>
        <Ionicons name="search-outline" size={20} color="#9ca3af" style={styles.searchIcon} />
        <TextInput
          ref={searchInputRef}
          style={[styles.input, isDark && styles.inputDark]}
          value={value}
          onChangeText={onChangeText}
          placeholder="Search SKU or part name..."
          placeholderTextColor="#6b7280"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          style={styles.cameraBtn}
          onPress={() => { haptics.tap(); openScanner(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="camera-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <Modal visible={scannerOpen} animationType="slide" onRequestClose={closeScanner}>
        <View style={styles.scannerContainer}>
          {device && hasPermission ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              format={format}
              isActive={isCameraActive}
              codeScanner={codeScanner}
            />
          ) : (
            <View style={styles.noCamera}>
              <Text style={styles.noCameraText}>Camera permission required.</Text>
            </View>
          )}

          {/* Viewfinder overlay */}
          <View style={styles.overlay}>
            <View style={styles.viewfinder} />
            <Text style={styles.scanHint}>Align barcode within the frame</Text>
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={() => { haptics.tap(); closeScanner(); }}>
            <Ionicons name="close-circle" size={44} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  containerDark: {
    backgroundColor: '#1f2937',
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 0,
  },
  inputDark: {
    color: '#f9fafb',
  },
  cameraBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    marginLeft: 8,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  noCamera: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noCameraText: {
    color: '#fff',
    fontSize: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: '80%',
    height: 140,
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanHint: {
    color: '#fff',
    marginTop: 16,
    fontSize: 14,
    opacity: 0.8,
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    right: 20,
  },
});
