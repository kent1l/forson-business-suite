import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import useAuthStore from '../store/useAuthStore';
import useSettingsStore from '../store/useSettingsStore';

/**
 * Downloads an authenticated PDF and hands it to the OS share sheet.
 *
 * The obvious approach -- opening the URL in a browser -- cannot work: every
 * payslip endpoint requires an Authorization header, and a URL opened
 * externally carries none. `File.downloadFileAsync` takes explicit headers, so
 * the token travels with the request and the bytes never pass through JS.
 *
 * Written to the cache directory rather than documents: a payslip left in
 * durable storage would outlive the session on a phone several people share.
 */
export async function downloadAndOpenPdf(endpoint: string, filename: string): Promise<void> {
  const serverIp = useSettingsStore.getState().serverIp;
  if (!serverIp) throw new Error('No server configured. Set the server IP in Settings.');

  const token = useAuthStore.getState().token || await SecureStore.getItemAsync('auth_token');
  if (!token) throw new Error('You are signed out. Please sign in again.');

  const base = serverIp.startsWith('http') ? serverIp : `http://${serverIp}`;
  const url = `${base}/api${endpoint}`;

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = new File(Paths.cache, safeName);

  // idempotent, so re-opening the same payslip overwrites rather than throwing
  // DestinationAlreadyExists on the second tap.
  const downloaded = await File.downloadFileAsync(url, target, {
    headers: { Authorization: `Bearer ${token}` },
    idempotent: true,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('This device cannot open PDF files.');
  }

  await Sharing.shareAsync(downloaded.uri, {
    mimeType: 'application/pdf',
    dialogTitle: filename,
    UTI: 'com.adobe.pdf',
  });
}

export default downloadAndOpenPdf;
