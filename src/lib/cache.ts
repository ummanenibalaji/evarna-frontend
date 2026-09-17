/**
 * Last-known server data, so a screen can paint immediately and revalidate
 * (stale-while-revalidate), and still show something when the network is gone.
 *
 * Entries are namespaced per user, so one account never sees another's data on
 * a shared phone, and the version is in the key prefix: when a cached shape
 * changes, bump it and old entries are simply never read again (sign-out
 * clears every version). A cache is only ever an optimisation, so nothing
 * here throws: a failed read is a miss, and an unreadable entry is dropped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const ROOT = 'evarna_cache_';
const PREFIX = `${ROOT}v1:`;

const keyFor = (userId: string, key: string) => `${PREFIX}${userId}:${key}`;

// Wrapped so a stored `undefined` or a foreign value is distinguishable from
// real data.
interface Envelope<T> {
  v: T;
}

export async function readCache<T>(userId: string, key: string): Promise<T | null> {
  if (!userId) return null;
  const k = keyFor(userId, key);
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(k);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T> | null;
    if (parsed && typeof parsed === 'object' && 'v' in parsed) return parsed.v ?? null;
  } catch { /* fall through: corrupt */ }
  AsyncStorage.removeItem(k).catch(() => {});
  return null;
}

export async function writeCache<T>(userId: string, key: string, value: T): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(keyFor(userId, key), JSON.stringify({ v: value } satisfies Envelope<T>));
  } catch (e) {
    console.warn('[cache] write failed:', key, e);
  }
}

/** One user's entries, or with no id every cached entry of every version (sign-out). */
export async function clearUserCache(userId?: string): Promise<void> {
  const prefix = userId ? `${PREFIX}${userId}:` : ROOT;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch (e) {
    console.warn('[cache] clear failed:', e);
  }
}
