import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPHP } from '@/utils/currency';

interface Props {
  visible: boolean;
  invoiceNumber?: string;
  changeAmount?: number;
}

export default function SuccessOverlay({ visible, invoiceNumber, changeAmount }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      opacity.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Ionicons name="checkmark-circle" size={96} color="#fff" />
        <Text style={styles.title}>Transaction Complete</Text>
        {invoiceNumber ? (
          <Text style={styles.invoiceNum}>{invoiceNumber}</Text>
        ) : null}
        {changeAmount !== undefined && changeAmount > 0 ? (
          <View style={styles.changeContainer}>
            <Text style={styles.changeLabel}>Change</Text>
            <Text style={styles.changeValue}>{formatPHP(changeAmount)}</Text>
          </View>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  invoiceNum: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 18,
    marginTop: 8,
    fontWeight: '500',
    letterSpacing: 1,
  },
  changeContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
  },
  changeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  changeValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
});
