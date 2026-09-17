import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';

/** Download an authenticated PDF to cache, share it, then remove the temporary copy. */
export async function sharePurchaseOrderPdf(poId: number, poNumber?: string): Promise<void> {
  const serverIp = useSettingsStore.getState().serverIp;
  if (!serverIp) throw new Error('No server configured. Set the server IP in Settings.');
  const token = useAuthStore.getState().token || await SecureStore.getItemAsync('auth_token');
  if (!token) throw new Error('You are signed out. Please sign in again.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing a PDF is unavailable on this device.');

  const safeName = `${poNumber || `PO-${poId}`}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = new File(Paths.cache, `${safeName}.pdf`);
  const base = serverIp.startsWith('http') ? serverIp : `http://${serverIp}`;
  try {
    const file = await File.downloadFileAsync(`${base}/api/purchase-orders/${poId}/pdf`, target, {
      headers: { Authorization: `Bearer ${token}` }, idempotent: true,
    });
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: safeName, UTI: 'com.adobe.pdf' });
  } finally {
    // A share target receives its own URI grant. The app should not retain PO PDFs on shared devices.
    try { if (target.exists) target.delete(); } catch { /* cache cleanup is best effort */ }
  }
}
