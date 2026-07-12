import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Modal,
  TouchableOpacity,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';
import apiClient from '@/api/client';

interface StagingOverlayProps {
  visible: boolean;
  stagedSaleId: number | null; // raw numeric ID for polling
  transactionId: string;       // display label e.g. "STG-42"
  customerName: string;
  amount: number;
  onStageAnother: () => void;
}

type OverlayState = 'pending' | 'approved' | 'rejected';

const POLL_INTERVAL_MS = 4000;

export default function StagingOverlay({
  visible,
  stagedSaleId,
  transactionId,
  customerName,
  amount,
  onStageAnother,
}: StagingOverlayProps) {
  const [overlayState, setOverlayState] = useState<OverlayState>('pending');
  const [approvedInvoice, setApprovedInvoice] = useState<string | null>(null);

  // ── Animated values ────────────────────────────────────────────────────────
  const opacity    = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(0.9)).current;
  const spinVal    = useRef(new Animated.Value(0)).current;
  const pulseVal   = useRef(new Animated.Value(1)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const spinLoopRef  = useRef<Animated.CompositeAnimation | null>(null);
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────────
  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const checkStatus = useCallback(async () => {
    if (!stagedSaleId) return;
    try {
      const { data } = await apiClient.get(`/sales/staging/${stagedSaleId}`);
      if (data.status === 'APPROVED') {
        stopPolling();
        setApprovedInvoice(data.invoice_number || null);
        setOverlayState('approved');
        haptics.txComplete?.();
      } else if (data.status === 'REJECTED') {
        stopPolling();
        setOverlayState('rejected');
        haptics.error?.();
      }
    } catch {
      // silently retry next tick
    }
  }, [stagedSaleId]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible && stagedSaleId) {
      setOverlayState('pending');
      setApprovedInvoice(null);

      // entrance animation
      haptics.impact?.('medium');
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
      ]).start();

      // spin loop
      spinLoopRef.current = Animated.loop(
        Animated.timing(spinVal, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
      );
      spinLoopRef.current.start();

      // pulse loop
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseVal, { toValue: 1.4, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseVal, { toValue: 1, duration: 800, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current.start();

      // start polling after initial delay
      setTimeout(() => checkStatus(), 1500);
      pollRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
    } else {
      opacity.setValue(0);
      scale.setValue(0.9);
      stopPolling();
      spinLoopRef.current?.stop();
      pulseLoopRef.current?.stop();
    }
    return () => stopPolling();
  }, [visible, stagedSaleId]);

  // ── Approved entrance animation ────────────────────────────────────────────
  useEffect(() => {
    if (overlayState === 'approved') {
      spinLoopRef.current?.stop();
      pulseLoopRef.current?.stop();
      checkScale.setValue(0);
      Animated.spring(checkScale, {
        toValue: 1,
        friction: 5,
        tension: 50,
        useNativeDriver: true,
      }).start();
    }
  }, [overlayState]);

  if (!visible) return null;

  const spin = spinVal.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Approved state ─────────────────────────────────────────────────────────
  if (overlayState === 'approved') {
    return (
      <Modal visible transparent animationType="none">
        <Animated.View style={[styles.overlay, { opacity }]}>
          <View style={styles.contentContainer}>
            <Text style={styles.screenHeader}>TRANSACTION COMPLETE</Text>

            <Animated.View style={[styles.successCircle, { transform: [{ scale: checkScale }] }]}>
              <Ionicons name="checkmark" size={52} color="#fff" />
            </Animated.View>

            <Animated.View style={[styles.card, { transform: [{ scale }], marginTop: 32 }]}>
              <View style={styles.statusBadgeRow}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                <Text style={[styles.statusTitle, { color: '#10B981' }]}>APPROVED & POSTED</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.dataRow}>
                <Text style={styles.label}>Transaction ID</Text>
                <Text style={styles.valueHighlight}>{transactionId}</Text>
              </View>

              {approvedInvoice && (
                <View style={styles.dataRow}>
                  <Text style={styles.label}>Invoice Number</Text>
                  <Text style={[styles.valueHighlight, { color: '#10B981' }]}>{approvedInvoice}</Text>
                </View>
              )}

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
                <Text style={[styles.statusLabelYellow, { color: '#10B981' }]}>Paid & Posted</Text>
              </View>
            </Animated.View>

            <TouchableOpacity style={[styles.secondaryBtn, styles.successBtn]} onPress={onStageAnother}>
              <Text style={styles.secondaryBtnText}>STAGE ANOTHER SALE</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    );
  }

  // ── Rejected state ─────────────────────────────────────────────────────────
  if (overlayState === 'rejected') {
    return (
      <Modal visible transparent animationType="none">
        <Animated.View style={[styles.overlay, { opacity }]}>
          <View style={styles.contentContainer}>
            <Text style={styles.screenHeader}>TRANSACTION REJECTED</Text>

            <View style={[styles.successCircle, { backgroundColor: '#EF4444' }]}>
              <Ionicons name="close" size={52} color="#fff" />
            </View>

            <Animated.View style={[styles.card, { transform: [{ scale }], marginTop: 32 }]}>
              <View style={styles.statusBadgeRow}>
                <Ionicons name="close-circle" size={24} color="#EF4444" />
                <Text style={[styles.statusTitle, { color: '#EF4444' }]}>TRANSACTION REJECTED</Text>
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

              <Text style={styles.rejectedNote}>
                This transaction was rejected by the cashier. Please re-stage with corrections.
              </Text>
            </Animated.View>

            <TouchableOpacity style={styles.secondaryBtn} onPress={onStageAnother}>
              <Text style={styles.secondaryBtnText}>STAGE ANOTHER SALE</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Modal>
    );
  }

  // ── Pending state (default) ────────────────────────────────────────────────
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
            <Animated.View style={[styles.radarWave, { transform: [{ scale: pulseVal }] }]} />
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
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
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
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
    marginBottom: 4,
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
    fontSize: 14,
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
    gap: 10,
    marginTop: 32,
    marginBottom: 20,
  },
  radarWave: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  successBtn: {
    borderColor: 'rgba(16, 185, 129, 0.4)',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    marginTop: 24,
  },
  secondaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  rejectedNote: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
});
