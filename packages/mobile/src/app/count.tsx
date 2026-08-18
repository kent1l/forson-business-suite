import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import useCycleCountStore from '../store/useCycleCountStore';
import MobileCounter from '../components/MobileCounter';
import apiClient from '../api/client';
import PremiumScanner from '../components/ui/PremiumScanner';
import RequirePermission from '../components/RequirePermission';
import submitWithOutbox from '../offline/submitWithOutbox';
import Screen from '../components/ui/Screen';
import AppHeader from '../components/ui/AppHeader';
import { useTheme } from '@/hooks/use-theme';
import { Spacing, Radius, FontSize, FontWeight, type ThemeColors } from '@/constants/theme';

function CountScreenInner() {
  const theme = useTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
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
  const [serverOffset, setServerOffset] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  useEffect(() => {
    if (isAdHocMode && currentAdHocItem?.pendingBarcode) {
      setScannedBarcode(currentAdHocItem.pendingBarcode);
    }
  }, [isAdHocMode, currentAdHocItem]);

  useEffect(() => {
    const syncTime = async () => {
      try {
        const clientTimeBefore = Date.now();
        const response = await apiClient.get('/inventory/cycle-count/server-time');
        const clientTimeAfter = Date.now();
        const serverTime = new Date(response.data.serverTime).getTime();
        const latency = (clientTimeAfter - clientTimeBefore) / 2;
        setServerOffset((serverTime + latency) - clientTimeAfter);
      } catch (err) {
        console.error('Failed to sync server time:', err);
      }
    };
    syncTime();
  }, []);

  useEffect(() => {
    setStartTime(Date.now());
  }, [currentLineIndex, isAdHocMode]);

  useEffect(() => {
    return () => {
      clearAdHocMode();
    };
  }, [clearAdHocMode]);

  // Camera Modal States
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

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

  const handleBarcodeScanned = (barcode: string) => {
    if (currentLine.barcodes && currentLine.barcodes.includes(barcode)) {
      setScannedBarcode(barcode);
      closeCameraModal();
    } else {
      Alert.alert(
        'Link Barcode',
        `Do you want to link the scanned barcode (${barcode}) to this item?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Yes, Link It', 
            onPress: () => {
              setScannedBarcode(barcode);
              closeCameraModal();
            }
          }
        ]
      );
    }
  };

  /**
   * Checks a scanned barcode against the item being counted.
   *
   * This used to return success unconditionally, which meant the scanner
   * accepted any barcode at all -- including one from a different part sitting
   * on the same shelf. The count would then be recorded against the wrong item
   * with a scan that looked like proof it was the right one.
   *
   * In ad-hoc mode there is no expected part yet: the scan is what identifies
   * the item, so anything the catalogue knows about is valid.
   */
  const handleResolveBarcode = async (barcode: string) => {
    // A barcode already listed on the line needs no lookup, which also keeps
    // the common case working with no network at all.
    if (currentLine.barcodes?.includes(barcode)) {
      setScannedBarcode(barcode);
      return { status: 'success' as const };
    }

    try {
      const { data } = await apiClient.get(`/parts/barcode/${encodeURIComponent(barcode)}`);
      const scannedPartId = data?.part_id ?? data?.part?.part_id;

      if (!scannedPartId) {
        return { status: 'not_found' as const, message: 'That barcode is not in the catalogue.' };
      }

      if (isAdHocMode) {
        setScannedBarcode(barcode);
        return { status: 'success' as const };
      }

      if (String(scannedPartId) !== String(currentLine?.part_id)) {
        return {
          status: 'error' as const,
          message: `That is ${data?.display_name || 'a different part'}. You are counting ${currentLine?.display_name}.`,
        };
      }

      setScannedBarcode(barcode);
      return { status: 'success' as const };
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return { status: 'not_found' as const, message: 'That barcode is not in the catalogue.' };
      }
      return { status: 'error' as const, message: 'Could not check that barcode. Try again.' };
    }
  };


  const handleSubmitCount = async (countedQty: number) => {
    setIsSubmitting(true);
    try {
      const startedAt = startTime ? new Date(startTime + serverOffset).toISOString() : null;
      if (isAdHocMode) {
        // ── Ad-hoc path ──────────────────────────────────────────────────────
        const outcome = await submitAdHocCount(countedQty, startedAt, scannedBarcode);
        Haptics.notificationAsync(
          outcome.queued ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success
        );

        // Delay clearAdHocMode slightly to prevent state tearing/crashes during unmount
        setTimeout(() => {
          clearAdHocMode();
        }, 100);

        router.replace('/unassigned-search');
        if (outcome.queued) {
          setTimeout(() => {
            Alert.alert('Saved Offline', 'This count will be sent when the server is reachable.');
          }, 300);
        }
      } else {
        // ── Assigned batch path ──────────────────────────────────────────────
        const payload: any = { counted_qty: countedQty, started_at: startedAt };
        if (scannedBarcode) payload.scanned_barcode = scannedBarcode;

        // Queued rather than lost if the shop LAN is unreachable. `started_at`
        // is captured from the synced server clock at the top of this function,
        // so a count that syncs later still records when it was actually taken.
        const outcome = await submitWithOutbox('cycle-count-submit', payload, {
          lineId: currentLine.line_id,
          displayName: currentLine.display_name,
        });
        setIsSubmitting(false);

        if (outcome.queued) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }

        if (currentLineIndex + 1 < activeBatchData!.length) {
          setCurrentLineIndex((prev: number) => prev + 1);
          setScannedBarcode(null);
        } else {
          Alert.alert(
            'Batch Complete',
            outcome.queued
              ? 'All items counted. Some are waiting to sync and will be sent when the server is reachable.'
              : 'All items submitted successfully.', [
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
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={{ marginTop: 16 }}>
          {isAdHocMode ? 'Submitting find...' : 'Submitting batch...'}
        </Text>
      </View>
    );
  }

  const needsBarcode = !(currentLine.barcodes && currentLine.barcodes.length > 0) && !scannedBarcode;
  const hasBarcode: boolean = Boolean(currentLine.barcodes && currentLine.barcodes.length > 0) || Boolean(scannedBarcode);

  const openCameraModal = () => {
    setIsCameraModalOpen(true);
  };

  const closeCameraModal = () => {
    setIsCameraModalOpen(false);
  };

  return (
    <Screen>
      <AppHeader
        title="Active Count"
        subtitle={isAdHocMode ? 'Ad-hoc' : `Item ${currentLineIndex + 1} of ${activeBatchData?.length ?? 1}`}
        right={
          <TouchableOpacity
            onPress={openCameraModal}
            activeOpacity={0.75}
            accessibilityLabel={hasBarcode ? 'Barcode captured, scan again' : 'Scan barcode'}
            style={[
              styles.barcodePill,
              hasBarcode ? styles.barcodePillSuccess : styles.barcodePillNeutral,
            ]}
          >
            <Ionicons
              name={hasBarcode ? 'checkmark-circle' : 'barcode-outline'}
              size={14}
              color={theme.primaryText}
            />
            <Text style={styles.barcodePillText}>Barcode</Text>
          </TouchableOpacity>
        }
      />

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
            <Text style={[styles.progressText, { color: theme.warning, fontWeight: FontWeight.semibold }]}>
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
      <PremiumScanner
        visible={isCameraModalOpen}
        onClose={closeCameraModal}
        onBarcodeScanned={handleBarcodeScanned}
        onResolveBarcode={handleResolveBarcode}
        title={isAdHocMode ? "Ad-hoc Scan" : "Batch Scan"}
        autoCloseOnSuccess={true}
      />
    </Screen>
  );
}

/**
 * Guarded at the route, not just hidden on the dashboard. The app registers the
 * `mobile` URL scheme, so this screen is reachable directly regardless of which
 * tiles the dashboard chose to render.
 */
export default function CountScreen() {
  return (
    <RequirePermission permission="cycle_count:execute" title="Cycle count">
      <CountScreenInner />
    </RequirePermission>
  );
}

/**
 * Theme-driven so the count screen follows light and dark. Literals that
 * remain belong to the full-screen camera overlay, which is dark whatever
 * the app theme is.
 */
const makeStyles = (theme: ThemeColors) => StyleSheet.create({

  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 18,
    color: 'red',
  },
  barcodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
  },
  barcodePillSuccess: {
    backgroundColor: theme.success,
  },
  barcodePillNeutral: {
    backgroundColor: theme.textMuted,
  },
  barcodePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.primaryText,
  },
  itemTextZone: {
    flex: 1,
    backgroundColor: theme.surfaceSunken,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 16,
  },
  itemTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.text,
    textAlign: 'center',
  },
  itemSubtitle: {
    fontSize: 14,
    color: theme.textMuted,
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
    color: theme.textMuted,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: theme.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: theme.primary,
    borderRadius: 2,
  },
  counterZone: {
    backgroundColor: theme.surface,
  },
});
