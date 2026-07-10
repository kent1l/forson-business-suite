import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../api/client';
import useAuthStore from '../store/useAuthStore';
import usePosStore from '../store/usePosStore';
import SuccessOverlay from '@/components/pos/SuccessOverlay';
import { formatPHP } from '@/utils/currency';
import * as haptics from '@/utils/haptics';

export default function POSSettlementScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const insets = useSafeAreaInsets();

  const cart = usePosStore((s: any) => s.cart);
  const grandTotal = usePosStore((s: any) => s.grandTotal);

  // ── Remote data ────────────────────────────────────────────────────────────
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [taxRates, setTaxRates] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ── Settlement state ───────────────────────────────────────────────────────
  const [selectedMethod, setSelectedMethod] = useState<any>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [selectedTaxRate, setSelectedTaxRate] = useState<any>(null);
  const [tenderedAmount, setTenderedAmount] = useState('');
  const tenderedRef = useRef<TextInput>(null);

  // ── Submission state ───────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<{ visible: boolean; invoiceNumber?: string; changeAmount?: number }>({ visible: false });

  // ── Load data on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [pmRes, custRes, taxRes] = await Promise.all([
          apiClient.get('/payment-methods/enabled'),
          apiClient.get('/customers?status=active'),
          apiClient.get('/tax-rates'),
        ]);

        const methods = pmRes.data || [];
        const custs = custRes.data || [];
        const rates = taxRes.data || [];

        setPaymentMethods(methods);
        setCustomers(custs);
        setTaxRates(rates);

        // Defaults
        const cashMethod = methods.find((m: any) =>
          (m.name || m.method_name)?.toLowerCase() === 'cash'
        ) || methods[0];
        setSelectedMethod(cashMethod || null);

        const walkIn = custs.find((c: any) =>
          c.first_name?.toLowerCase() === 'walk-in'
        ) || custs[0];
        setSelectedCustomer(walkIn || null);

        const defaultRate = rates.find((r: any) => r.is_default) || null;
        setSelectedTaxRate(defaultRate);
      } catch (err) {
        // Non-fatal — user can still proceed
      } finally {
        setLoadingData(false);
      }
    })();
  }, []);

  // Auto-focus tendered input when Cash is selected
  useEffect(() => {
    if ((selectedMethod?.name || selectedMethod?.method_name || '').toLowerCase() === 'cash') {
      setTimeout(() => tenderedRef.current?.focus(), 350);
    }
  }, [selectedMethod]);

  const isCash = (selectedMethod?.name || selectedMethod?.method_name || '').toLowerCase() === 'cash';
  const tendered = parseFloat(tenderedAmount) || 0;
  const change = isCash ? tendered - grandTotal : 0;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleCompleteSale = useCallback(async () => {
    if (!selectedCustomer) {
      Alert.alert('Missing Customer', 'Please select a customer.');
      return;
    }
    if (isCash && tendered < grandTotal) {
      Alert.alert('Insufficient Tendered', `Tendered amount must be at least ${formatPHP(grandTotal)}.`);
      haptics.error();
      return;
    }

    setIsSubmitting(true);
    try {
      const paymentData = {
        customer_id: selectedCustomer.customer_id,
        employee_id: user?.employee_id,
        amount_paid: grandTotal,
        tendered_amount: isCash ? tendered : null,
        payment_method: selectedMethod?.name || selectedMethod?.method_name || 'Cash',
        payment_method_id: selectedMethod?.method_id ?? selectedMethod?.payment_method_id,
        terms: 'COD',
        tax_rate_id: selectedTaxRate?.tax_rate_id || null,
      };

      const result = await usePosStore.getState().submitInvoice(paymentData);

      haptics.txComplete();
      setSuccessData({ visible: true, invoiceNumber: result.invoice_number, changeAmount: change > 0 ? change : undefined });

      setTimeout(() => {
        setSuccessData({ visible: false });
        usePosStore.getState().clearCart();
        router.back();
      }, 2000);
    } catch (err: any) {
      haptics.error();
      const msg = err?.response?.data?.message || err?.message || 'Transaction failed. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCustomer, selectedMethod, selectedTaxRate, isCash, tendered, grandTotal, user, router]);

  const bg = isDark ? '#111827' : '#f9fafb';
  const cardBg = isDark ? '#1f2937' : '#fff';
  const textColor = isDark ? '#f9fafb' : '#111827';
  const subColor = isDark ? '#9ca3af' : '#6b7280';

  if (loadingData) {
    return (
      <View style={[styles.loading, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  return (
    <>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: cardBg, borderBottomColor: isDark ? '#374151' : '#e5e7eb' }]}>
          <TouchableOpacity onPress={() => { haptics.tap(); router.back(); }} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={textColor} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: textColor }]}>Checkout</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: 100 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Order summary */}
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionLabel, { color: subColor }]}>ORDER SUMMARY</Text>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryKey, { color: subColor }]}>{cart.length} item{cart.length !== 1 ? 's' : ''}</Text>
              <Text style={[styles.summaryVal, { color: textColor }]}>{formatPHP(grandTotal)}</Text>
            </View>
            <View style={[styles.divider, { borderColor: isDark ? '#374151' : '#f3f4f6' }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.totalLabel, { color: textColor }]}>Total</Text>
              <Text style={styles.totalAmount}>{formatPHP(grandTotal)}</Text>
            </View>
          </View>

          {/* Payment Method */}
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionLabel, { color: subColor }]}>PAYMENT METHOD</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              <View style={styles.pillRow}>
                {paymentMethods.map((m) => {
                  const mId = m.method_id ?? m.payment_method_id;
                  const mName = m.name ?? m.method_name;
                  const selected = (selectedMethod?.method_id ?? selectedMethod?.payment_method_id) === mId;
                  return (
                    <TouchableOpacity
                      key={mId}
                      style={[styles.pill, selected && styles.pillSelected]}
                      onPress={() => { haptics.tap(); setSelectedMethod(m); }}
                    >
                      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                        {mName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Cash tendered */}
          {isCash && (
            <View style={[styles.card, { backgroundColor: cardBg }]}>
              <Text style={[styles.sectionLabel, { color: subColor }]}>TENDERED AMOUNT</Text>
              <TextInput
                ref={tenderedRef}
                style={[styles.tenderedInput, { color: textColor, borderColor: isDark ? '#374151' : '#d1d5db' }]}
                value={tenderedAmount}
                onChangeText={setTenderedAmount}
                keyboardType="decimal-pad"
                placeholder={formatPHP(grandTotal)}
                placeholderTextColor="#9ca3af"
                selectTextOnFocus
              />
              {tendered > 0 && (
                <View style={styles.changeRow}>
                  <Text style={[styles.changeLabel, { color: subColor }]}>Change</Text>
                  <Text style={[styles.changeAmount, { color: change >= 0 ? '#10B981' : '#ef4444' }]}>
                    {formatPHP(Math.abs(change))}
                    {change < 0 ? ' (short)' : ''}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Customer */}
          <View style={[styles.card, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionLabel, { color: subColor }]}>CUSTOMER</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              <View style={styles.pillRow}>
                {customers.slice(0, 20).map((c) => {
                  const selected = selectedCustomer?.customer_id === c.customer_id;
                  const label = `${c.first_name} ${c.last_name || ''}`.trim();
                  return (
                    <TouchableOpacity
                      key={c.customer_id}
                      style={[styles.pill, selected && styles.pillSelected]}
                      onPress={() => { haptics.tap(); setSelectedCustomer(c); }}
                    >
                      <Text style={[styles.pillText, selected && styles.pillTextSelected]} numberOfLines={1}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Tax Rate */}
          {taxRates.length > 0 && (
            <View style={[styles.card, { backgroundColor: cardBg }]}>
              <Text style={[styles.sectionLabel, { color: subColor }]}>TAX RATE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                <View style={styles.pillRow}>
                  {taxRates.map((r) => {
                    const selected = selectedTaxRate?.tax_rate_id === r.tax_rate_id;
                    return (
                      <TouchableOpacity
                        key={r.tax_rate_id}
                        style={[styles.pill, selected && styles.pillSelected]}
                        onPress={() => { haptics.tap(); setSelectedTaxRate(r); }}
                      >
                        <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                          {r.rate_name} ({r.rate_percentage}%)
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}
        </ScrollView>

        {/* Complete Sale button */}
        <View style={[
          styles.footer,
          {
            backgroundColor: cardBg,
            borderTopColor: isDark ? '#374151' : '#e5e7eb',
            paddingBottom: insets.bottom > 0 ? insets.bottom + 8 : 16,
          }
        ]}>
          <TouchableOpacity
            style={[styles.completeBtn, isSubmitting && styles.completeBtnDisabled]}
            onPress={handleCompleteSale}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.completeBtnText}>Complete Sale — {formatPHP(grandTotal)}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <SuccessOverlay visible={successData.visible} invoiceNumber={successData.invoiceNumber} changeAmount={successData.changeAmount} />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  content: { padding: 16, gap: 12 },
  card: {
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryKey: { fontSize: 14 },
  summaryVal: { fontSize: 14, fontWeight: '600' },
  divider: { borderTopWidth: 1, marginVertical: 8 },
  totalLabel: { fontSize: 16, fontWeight: '700' },
  totalAmount: { fontSize: 20, fontWeight: '800', color: '#10B981' },
  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    backgroundColor: 'transparent',
  },
  pillSelected: { backgroundColor: '#10B981', borderColor: '#10B981' },
  pillText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  pillTextSelected: { color: '#fff' },
  tenderedInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'center',
  },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  changeLabel: { fontSize: 14 },
  changeAmount: { fontSize: 20, fontWeight: '800' },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  completeBtn: {
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 17,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  completeBtnDisabled: { backgroundColor: '#9ca3af', shadowOpacity: 0, elevation: 0 },
  completeBtnText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
});
