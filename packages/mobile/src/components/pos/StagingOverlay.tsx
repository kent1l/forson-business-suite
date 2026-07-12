import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Modal, TouchableOpacity, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

interface StagingOverlayProps {
  visible: boolean;
  transactionId: string;
  customerName: string;
  amount: number;
  onStageAnother: () => void;
}

export default function StagingOverlay({
  visible,
  transactionId,
  customerName,
  amount,
  onStageAnother,
}: StagingOverlayProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  const spinVal = useRef(new Animated.Value(0)).current;
  const pulseVal = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      if (haptics && typeof haptics.impact === 'function') {
        haptics.impact('medium');
      }
      
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 6,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();

      Animated.loop(
        Animated.timing(spinVal, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseVal, {
            toValue: 1.4,
            duration: 1200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseVal, {
            toValue: 1,
            duration: 800,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          })
        ])
      ).start();

    } else {
      opacity.setValue(0);
      scale.setValue(0.9);
    }
  }, [visible]);

  if (!visible) return null;

  const spin = spinVal.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Modal visible={visible} transparent animationType="none">
      <Animated.View style={[styles.overlay, { opacity }]}>
        <View style={styles.contentContainer}>
          <Text style={styles.screenHeader}>STAGING QUEUE</Text>
          <Animated.View style={[styles.pulseRadar, { transform: [{ scale: pulseVal }] }]} />
          
          <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
            <View style={styles.statusBadgeRow}>
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Ionicons name="hourglass-outline" size={26} color="#F59E0B" />
              </Animated.View>
              <Text style={styles.statusTitle}>STAGED & PENDING APPROVAL</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.dataRow}>
              <Text style={styles.label}>Transaction ID</Text>
              <Text style={styles.valueHighlight}>{transactionId}</Text>
            </View>
            
            <View style={styles.dataRow}>
              <Text style={styles.label}>Customer</Text>
              <Text style={styles.valueText}>{customerName}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.totalBlock}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{formatPHP(amount)}</Text>
            </View>

            <View style={styles.dataRow}>
              <Text style={styles.label}>Payment Status</Text>
              <Text style={styles.statusLabelYellow}>Pending Review</Text>
            </View>
          </Animated.View>

          <View style={styles.waitingContainer}>
            <View style={styles.radarWave} />
            <Text style={styles.waitingText}>Awaiting Manager Sign-Off...</Text>
          </View>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onStageAnother}>
            <Text style={styles.secondaryBtnText}>STAGE ANOTHER SALE</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    width: '90%',
    maxWidth: 380,
    alignItems: 'center',
  },
  screenHeader: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 20,
  },
  pulseRadar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    position: 'absolute',
    top: 50,
  },
  card: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 10,
  },
  statusTitle: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 16,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  valueText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  valueHighlight: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '700',
  },
  totalBlock: {
    alignItems: 'center',
    marginVertical: 10,
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginBottom: 4,
  },
  totalValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
  },
  statusLabelYellow: {
    color: '#F59E0B',
    fontSize: 13,
    fontWeight: '600',
  },
  waitingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    marginBottom: 20,
  },
  radarWave: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F59E0B',
  },
  waitingText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
