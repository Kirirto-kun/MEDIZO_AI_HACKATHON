import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERSIST_KEY } from './query-persist';
import { tokenStore } from './token-store';

/**
 * Removes every piece of state left by the retired native mobile client.
 *
 * The current application authenticates inside a WebView with HttpOnly
 * cookies, but upgrades from the first native release can still have bearer
 * tokens in SecureStore and user-scoped React Query data in AsyncStorage.
 * Recovery must clear both even when one native storage backend fails: a
 * broken SecureStore entry must never prevent the cached user data from being
 * removed (and vice versa).
 *
 * WebView cookies/cache/history are cleared by `WebAppShell`, because those
 * stores are owned by the native WebView rather than React Native storage.
 */
export async function clearLegacyMobileState(): Promise<void> {
  // Do not call the retired client's network logout here. Reading its refresh
  // token first can hang inside a damaged SecureStore bridge, and waiting for
  // a network request before reaching `finally { tokenStore.clear() }` was the
  // original unhandled/hanging startup failure. These obsolete bearer tokens
  // are removed locally and are never used by the current cookie-based shell;
  // the active WebView cookie family is revoked separately by WebAppShell's
  // same-origin recovery flow.
  await Promise.allSettled([
    Promise.resolve().then(() => tokenStore.clear()),
    Promise.resolve().then(() => AsyncStorage.removeItem(PERSIST_KEY)),
  ]);
}
