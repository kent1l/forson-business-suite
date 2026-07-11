import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Text,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as haptics from '@/utils/haptics';
import PremiumScanner from '../ui/PremiumScanner';

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

  const openScanner = useCallback(() => {
    setScannerOpen(true);
  }, []);

  const closeScanner = useCallback(() => {
    setScannerOpen(false);
  }, []);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    onScanResult(barcode);
    closeScanner();
  }, [onScanResult, closeScanner]);


  return (
    <>
      <View style={[styles.container, isDark && styles.containerDark]}>
        <TouchableOpacity
          style={styles.leftBtn}
          onPress={() => { haptics.tap(); openScanner(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="barcode-outline" size={24} color="#9ca3af" />
        </TouchableOpacity>
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
        />
        {!!value && (
          <TouchableOpacity
            style={styles.rightBtn}
            onPress={() => { haptics.tap(); onChangeText(''); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-outline" size={24} color="#9ca3af" />
          </TouchableOpacity>
        )}
      </View>

      <PremiumScanner
        visible={scannerOpen}
        onClose={closeScanner}
        onBarcodeScanned={handleBarcodeScanned}
        title="POS Scan"
        autoCloseOnSuccess={true}
      />
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
  leftBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  rightBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
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
