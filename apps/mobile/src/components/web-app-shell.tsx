import { DOCJOB_MOBILE_USER_AGENT_TOKEN } from '@docjob/types';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { API_BASE_URL } from '../lib/config';
import { clearLegacyMobileState } from '../lib/recovery';
import { colors } from '../theme/colors';

export type NavigationDisposition = 'internal' | 'external' | 'blocked';
type WebShellMode = 'normal' | 'logout' | 'clean-login' | 'isolated-login';

type ShellMessage =
  | { type: 'runtime-error'; message: string }
  | { type: 'logout-complete'; ok: boolean };

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const APP_VERSION = Constants.expoConfig?.version ?? '1.1.2';
const ANDROID_VERSION_CODE = Constants.expoConfig?.android?.versionCode ?? 4;
const SHELL_MESSAGE_CHANNEL = 'docjob-native-shell';
const RECOVERY_LOGOUT_TIMEOUT_MS = 3_000;

export const DOCJOB_WEB_APP_URL = `${API_BASE_URL.replace(/\/+$/, '')}/`;
export const DOCJOB_LOGIN_URL = new URL('/login', DOCJOB_WEB_APP_URL).href;
const DOCJOB_RECOVERY_LOGOUT_URL = new URL(
  '/login?mobileRecovery=1',
  DOCJOB_WEB_APP_URL,
).href;
const DOCJOB_RECOVERY_LOGIN_URL = new URL(
  '/login?mobileRecoveryDone=1',
  DOCJOB_WEB_APP_URL,
).href;
export const DOCJOB_MOBILE_USER_AGENT =
  `${DOCJOB_MOBILE_USER_AGENT_TOKEN}/${APP_VERSION}`;

/**
 * Runs before the web application's bundle. An uncaught browser error can
 * otherwise leave a React/Next screen visually broken while the native
 * WebView itself reports a successful HTTP load. Reporting it to the native
 * layer gives the user the same retry/reset escape route as a network or
 * renderer-process failure.
 */
export const WEB_RUNTIME_MONITOR_SCRIPT = `
(function () {
  if (window.__docjobNativeMonitorInstalled) return;
  window.__docjobNativeMonitorInstalled = true;
  var report = function (message) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: ${JSON.stringify(SHELL_MESSAGE_CHANNEL)},
        type: 'runtime-error',
        message: String(message || 'Неизвестная ошибка страницы').slice(0, 500)
      }));
    } catch (_) {}
  };
  window.addEventListener('error', function (event) {
    if (event && (event.error || event.message)) {
      report(event.message || (event.error && event.error.message));
    }
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    report(reason && reason.message ? reason.message : reason);
  });
})();
true;
`;

/**
 * First tries to revoke the current cookie session through the same-origin
 * logout endpoint. This is executed in a freshly mounted *persistent*
 * WebView, so iOS can also expire its persistent WKWebView HttpOnly cookies.
 * A confirmed logout keeps the next login persistent; a failure/timeout
 * advances through an isolated cookie store so recovery still cannot loop.
 */
export const WEB_RECOVERY_LOGOUT_SCRIPT = `
(function () {
  if (window.__docjobNativeLogoutStarted) return;
  window.__docjobNativeLogoutStarted = true;
  var notify = function (ok) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: ${JSON.stringify(SHELL_MESSAGE_CHANNEL)},
        type: 'logout-complete',
        ok: Boolean(ok)
      }));
    } catch (_) {}
  };
  try {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (response) {
      notify(response.ok);
    }).catch(function () {
      notify(false);
    });
  } catch (_) {
    notify(false);
  }
})();
true;
`;

/** Clear non-cookie browser state that can preserve a bad client snapshot. */
export const WEB_RECOVERY_STORAGE_SCRIPT = `
(function () {
  try { window.localStorage.clear(); } catch (_) {}
  try { window.sessionStorage.clear(); } catch (_) {}
  try {
    if (window.caches && window.caches.keys) {
      window.caches.keys().then(function (keys) {
        keys.forEach(function (key) { window.caches.delete(key); });
      }).catch(function () {});
    }
  } catch (_) {}
  try {
    if (window.indexedDB && window.indexedDB.databases) {
      window.indexedDB.databases().then(function (databases) {
        databases.forEach(function (database) {
          if (database.name) window.indexedDB.deleteDatabase(database.name);
        });
      }).catch(function () {});
    }
  } catch (_) {}
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        registrations.forEach(function (registration) { registration.unregister(); });
      }).catch(function () {});
    }
  } catch (_) {}
})();
true;
`;

export function parseShellMessage(raw: string): ShellMessage | null {
  if (!raw || raw.length > 2_000) return null;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.channel !== SHELL_MESSAGE_CHANNEL) return null;
    if (value.type === 'logout-complete' && typeof value.ok === 'boolean') {
      return { type: 'logout-complete', ok: value.ok };
    }
    if (value.type === 'runtime-error' && typeof value.message === 'string') {
      const message = value.message.trim().slice(0, 500);
      return message ? { type: 'runtime-error', message } : null;
    }
  } catch {
    // Ignore arbitrary messages posted by application pages/third parties.
  }
  return null;
}

export function isMainDocumentHttpError(
  requestUrl: string,
  mainDocumentUrl: string,
): boolean {
  try {
    const request = new URL(requestUrl, DOCJOB_WEB_APP_URL);
    const main = new URL(mainDocumentUrl, DOCJOB_WEB_APP_URL);
    return (
      request.origin === main.origin &&
      request.pathname === main.pathname &&
      request.search === main.search
    );
  } catch {
    return false;
  }
}

/**
 * Keep every DocJob page inside the app, but hand ordinary web, email and
 * telephone links to Android/iOS. Unknown schemes (javascript:, intent:,
 * file:, etc.) are rejected instead of being passed to another application.
 */
export function classifyNavigation(
  requestUrl: string,
  appUrl = DOCJOB_WEB_APP_URL,
): NavigationDisposition {
  if (requestUrl === 'about:blank') return 'internal';

  try {
    const target = new URL(requestUrl, appUrl);
    const appOrigin = new URL(appUrl).origin;

    if (
      (target.protocol === 'http:' ||
        target.protocol === 'https:' ||
        target.protocol === 'blob:') &&
      target.origin === appOrigin
    ) {
      return 'internal';
    }

    return EXTERNAL_PROTOCOLS.has(target.protocol) ? 'external' : 'blocked';
  } catch {
    return 'blocked';
  }
}

export function handleAndroidBack(
  canGoBack: boolean,
  goBack: () => void,
): boolean {
  if (!canGoBack) return false;
  goBack();
  return true;
}

export function handleOpenWindow(
  targetUrl: string,
  openInternal: (url: string) => void,
  openExternal: (url: string) => void,
  appUrl = DOCJOB_WEB_APP_URL,
): NavigationDisposition {
  const disposition = classifyNavigation(targetUrl, appUrl);

  // Android can report about:blank while creating the temporary child
  // WebView. It is an implementation detail, not a useful navigation target.
  if (targetUrl === 'about:blank') return disposition;

  if (disposition === 'internal') {
    openInternal(new URL(targetUrl, appUrl).href);
  } else if (disposition === 'external') {
    openExternal(targetUrl);
  }
  return disposition;
}

function NativeError({
  message,
  onRetry,
  onResetSession,
}: {
  message: string;
  onRetry(): void;
  onResetSession(): void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.overlayScrollContent}
      keyboardShouldPersistTaps="handled"
      style={styles.errorOverlay}
      testID="web-shell-error"
    >
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Не удалось открыть DocJob</Text>
        <Text style={styles.errorDescription}>
          Экран не загрузился или завершился с ошибкой. Можно повторить либо
          очистить текущую сессию и вернуться ко входу.
        </Text>
        <Text style={styles.errorDetails} numberOfLines={3}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          testID="web-shell-retry"
        >
          <Text style={styles.primaryButtonText}>Повторить</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onResetSession}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          testID="web-shell-error-login-reset"
        >
          <Text style={styles.secondaryButtonText}>Очистить сессию и войти</Text>
        </Pressable>
        <Text style={styles.versionText}>
          Версия {APP_VERSION} ({ANDROID_VERSION_CODE})
        </Text>
      </View>
    </ScrollView>
  );
}

function RecoveryPanel({
  onClose,
  onReload,
  onResetSession,
}: {
  onClose(): void;
  onReload(): void;
  onResetSession(): void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.overlayScrollContent}
      keyboardShouldPersistTaps="handled"
      style={styles.recoveryOverlay}
      testID="web-shell-recovery-panel"
    >
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Восстановление приложения</Text>
        <Text style={styles.errorDescription}>
          Если страница зависла, стала пустой или элементы экрана съехали,
          перезагрузите её. Если это не помогло — сбросьте сессию и войдите снова.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onReload}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          testID="web-shell-recovery-reload"
        >
          <Text style={styles.primaryButtonText}>Перезагрузить страницу</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onResetSession}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          testID="web-shell-recovery-login-reset"
        >
          <Text style={styles.secondaryButtonText}>Очистить сессию и войти</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.cancelButton, pressed && styles.buttonPressed]}
          testID="web-shell-recovery-close"
        >
          <Text style={styles.cancelButtonText}>Продолжить без изменений</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function ResettingOverlay() {
  return (
    <View style={styles.resettingOverlay} testID="web-shell-resetting">
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.resettingText}>Очищаем сессию и открываем вход…</Text>
    </View>
  );
}

/**
 * The application is a hardened native shell around the responsive web
 * product. Users and reviewers therefore share the exact same pages, forms,
 * validation and capabilities with the browser version.
 */
export function WebAppShell({
  recoveryTimeoutMs = RECOVERY_LOGOUT_TIMEOUT_MS,
  startInRecoveryMode = false,
}: {
  recoveryTimeoutMs?: number;
  startInRecoveryMode?: boolean;
}) {
  const initialMode: WebShellMode = startInRecoveryMode ? 'logout' : 'normal';
  const webViewRef = useRef<WebView | null>(null);
  const canGoBackRef = useRef(false);
  const mainDocumentUrlRef = useRef(DOCJOB_WEB_APP_URL);
  const modeRef = useRef<WebShellMode>(initialMode);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [mode, setMode] = useState<WebShellMode>(initialMode);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const source = useMemo(() => {
    if (mode === 'logout') return { uri: DOCJOB_RECOVERY_LOGOUT_URL };
    if (mode === 'clean-login' || mode === 'isolated-login') {
      return { uri: DOCJOB_RECOVERY_LOGIN_URL };
    }
    return { uri: DOCJOB_WEB_APP_URL };
  }, [mode]);
  const injectedScript = useMemo(
    () =>
      mode === 'logout'
        ? `${WEB_RUNTIME_MONITOR_SCRIPT}\n${WEB_RECOVERY_LOGOUT_SCRIPT}`
        : mode === 'clean-login' || mode === 'isolated-login'
          ? `${WEB_RECOVERY_STORAGE_SCRIPT}\n${WEB_RUNTIME_MONITOR_SCRIPT}`
          : WEB_RUNTIME_MONITOR_SCRIPT,
    [mode],
  );
  const isResetting = mode === 'logout';

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const finishRecovery = useCallback((persistentCookiesCleared = false) => {
    if (modeRef.current !== 'logout') return;

    clearRecoveryTimer();
    webViewRef.current?.stopLoading?.();
    webViewRef.current?.clearFormData?.();
    webViewRef.current?.clearHistory?.();
    webViewRef.current?.clearCache?.(true);
    canGoBackRef.current = false;
    const nextMode: WebShellMode = persistentCookiesCleared
      ? 'clean-login'
      : 'isolated-login';
    modeRef.current = nextMode;
    setMode(nextMode);
    setError(null);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
  }, [clearRecoveryTimer]);

  useEffect(() => {
    if (mode !== 'logout') return undefined;

    clearRecoveryTimer();
    recoveryTimerRef.current = setTimeout(() => {
      finishRecovery(false);
    }, recoveryTimeoutMs);
    return clearRecoveryTimer;
  }, [clearRecoveryTimer, finishRecovery, mode, recoveryTimeoutMs]);

  useEffect(() => {
    // Version 1.0 used bearer/refresh tokens in SecureStore. The unified web
    // surface uses HttpOnly cookies, so revoke/remove the legacy token family
    // and its user-scoped persisted query cache during an in-place upgrade.
    void clearLegacyMobileState();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () =>
      handleAndroidBack(canGoBackRef.current, () => webViewRef.current?.goBack()),
    );
    return () => subscription.remove();
  }, []);

  const openExternal = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // Stay on the current page when the device has no handler for the URL.
    }
  }, []);

  const openInternal = useCallback((url: string) => {
    // Keep same-origin target=_blank links in the authenticated WebView.
    // The URL is normalized and exact-origin validated by handleOpenWindow
    // before it reaches this callback.
    webViewRef.current?.injectJavaScript(
      `window.location.assign(${JSON.stringify(url)}); true;`,
    );
  }, []);

  const retry = useCallback(() => {
    setRecoveryOpen(false);
    setError(null);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
  }, []);

  const resetSession = useCallback(() => {
    if (modeRef.current === 'logout') return;

    clearRecoveryTimer();
    webViewRef.current?.stopLoading?.();
    webViewRef.current?.clearFormData?.();
    webViewRef.current?.clearHistory?.();
    webViewRef.current?.clearCache?.(true);
    canGoBackRef.current = false;
    modeRef.current = 'logout';
    setMode('logout');
    setRecoveryOpen(false);
    setError(null);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
    void clearLegacyMobileState();
  }, [clearRecoveryTimer]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.container}>
          <WebView
            ref={webViewRef}
            key={webViewKey}
            source={source}
            applicationNameForUserAgent={DOCJOB_MOBILE_USER_AGENT}
            injectedJavaScriptBeforeContentLoaded={injectedScript}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(request) => {
              const disposition = classifyNavigation(request.url);
              if (disposition === 'internal') return true;
              if (disposition === 'external') void openExternal(request.url);
              return false;
            }}
            onOpenWindow={({ nativeEvent }) => {
              handleOpenWindow(
                nativeEvent.targetUrl,
                openInternal,
                (url) => void openExternal(url),
              );
            }}
            onNavigationStateChange={(navigation) => {
              canGoBackRef.current = navigation.canGoBack;
              mainDocumentUrlRef.current = navigation.url;
            }}
            onLoadStart={({ nativeEvent }) => {
              mainDocumentUrlRef.current = nativeEvent.url;
              setError(null);
              setLoadProgress(0);
            }}
            onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
            onLoadEnd={() => setLoadProgress(1)}
            onError={({ nativeEvent }) => {
              setError(nativeEvent.description || 'Ошибка сети');
            }}
            onHttpError={({ nativeEvent }) => {
              if (
                nativeEvent.statusCode >= 400 &&
                isMainDocumentHttpError(
                  nativeEvent.url,
                  mainDocumentUrlRef.current,
                )
              ) {
                setLoadProgress(1);
                setError(`Сервер вернул ошибку ${nativeEvent.statusCode}`);
              }
            }}
            onRenderProcessGone={({ nativeEvent }) => {
              setLoadProgress(1);
              setError(
                nativeEvent.didCrash
                  ? 'Процесс отображения WebView аварийно завершился'
                  : 'Процесс отображения WebView был остановлен системой',
              );
            }}
            onContentProcessDidTerminate={() => {
              setLoadProgress(1);
              setError('Процесс отображения страницы был перезапущен системой');
            }}
            onMessage={({ nativeEvent }) => {
              const message = parseShellMessage(nativeEvent.data);
              if (!message) return;

              if (message.type === 'logout-complete') {
                finishRecovery(message.ok);
              } else if (modeRef.current !== 'logout') {
                setLoadProgress(1);
                setError(`Ошибка страницы: ${message.message}`);
              }
            }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            // The shell is online-only. Reusing a cached Next.js document
            // after a server deploy can retain obsolete Server Action IDs
            // and strand the user on a client/server version mismatch.
            cacheEnabled={false}
            cacheMode="LOAD_NO_CACHE"
            // Preserve a newly created session after a confirmed logout.
            // If logout failed/timed out, isolate the login from the stale
            // persistent cookie store so recovery still cannot loop back to
            // the broken account.
            incognito={mode === 'isolated-login'}
            mixedContentMode="never"
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            // Keep Android's secure default. Setting this false lets a
            // malicious iframe escape into the top-level DOM.
            setSupportMultipleWindows
            javaScriptCanOpenWindowsAutomatically={false}
            allowsBackForwardNavigationGestures
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            scalesPageToFit
            textZoom={100}
            androidLayerType="none"
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            showsHorizontalScrollIndicator={false}
            downloadingMessage="Файл загружается…"
            lackPermissionToDownloadMessage="Не удалось сохранить файл"
            style={styles.webView}
            testID="docjob-web-app"
          />

          {loadProgress < 1 && !error && !isResetting ? (
            <View pointerEvents="none" style={styles.loadingOverlay} testID="web-shell-loading">
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : null}

          {loadProgress > 0 && loadProgress < 1 && !error && !isResetting ? (
            <View
              pointerEvents="none"
              style={[styles.progress, { width: `${Math.max(8, loadProgress * 100)}%` }]}
            />
          ) : null}

          {!error && !recoveryOpen && !isResetting ? (
            <Pressable
              accessibilityHint="Открывает перезагрузку и сброс сессии"
              accessibilityLabel="Восстановление приложения"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setRecoveryOpen(true)}
              style={({ pressed }) => [
                styles.recoveryTrigger,
                pressed && styles.buttonPressed,
              ]}
              testID="web-shell-recovery-trigger"
            >
              <Text style={styles.recoveryTriggerIcon}>↻</Text>
              <Text style={styles.recoveryTriggerText}>Помощь</Text>
            </Pressable>
          ) : null}

          {error ? (
            <NativeError
              message={error}
              onResetSession={resetSession}
              onRetry={retry}
            />
          ) : null}

          {recoveryOpen && !error ? (
            <RecoveryPanel
              onClose={() => setRecoveryOpen(false)}
              onReload={retry}
              onResetSession={resetSession}
            />
          ) : null}

          {isResetting ? <ResettingOverlay /> : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  progress: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 3,
    backgroundColor: colors.primary,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  recoveryOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  overlayScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  errorCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorDescription: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  errorDetails: {
    marginTop: 8,
    color: colors.textSubtle,
    fontSize: 12,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    minHeight: 48,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    width: '100%',
    minHeight: 48,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  cancelButton: {
    minHeight: 44,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  recoveryTrigger: {
    position: 'absolute',
    right: 10,
    bottom: 12,
    minWidth: 76,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surface,
    elevation: 6,
  },
  recoveryTriggerIcon: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  recoveryTriggerText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  resettingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
    backgroundColor: colors.background,
  },
  resettingText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  versionText: {
    marginTop: 18,
    color: colors.textSubtle,
    fontSize: 11,
  },
});
