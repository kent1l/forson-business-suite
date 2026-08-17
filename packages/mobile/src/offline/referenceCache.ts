import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Last-known-good copies of small reference lists (customers, payment
 * methods, tax rates) that POS checkout needs but that have no dedicated
 * offline store of their own, unlike the parts catalogue.
 *
 * These lists change rarely and are small, so a full sync/cursor setup like
 * catalogDb.ts would be overkill. Simplest thing that fixes the actual bug:
 * remember whatever the last successful fetch returned, and serve that when
 * the live request can't be made. Read-only from the POS screen's point of
 * view -- nothing here is ever queued or written back to the server.
 */

const keyFor = (name: string) => `offline_ref_cache_v1_${name}`;

export async function loadCachedList<T = any>(name: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(name));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function cacheList(name: string, items: unknown[]): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(name), JSON.stringify(items ?? []));
  } catch {
    // Best effort -- losing the cache just means the next offline load falls
    // back to an empty list, same as today.
  }
}
