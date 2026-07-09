import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  visible: boolean;
  invoiceNumber?: string;
}

export default function SuccessOverlay({ visible, invoiceNumber }: Props) {
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
});
