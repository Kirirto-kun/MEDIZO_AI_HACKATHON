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
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { logout as clearLegacyNativeSession } from '../lib/auth-client';
import { API_BASE_URL } from '../lib/config';
import { colors } from '../theme/colors';

export type NavigationDisposition = 'internal' | 'external' | 'blocked';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const APP_VERSION = Constants.expoConfig?.version ?? '1.1.1';
const ANDROID_VERSION_CODE = Constants.expoConfig?.android?.versionCode ?? 3;

export const DOCJOB_WEB_APP_URL = `${API_BASE_URL.replace(/\/+$/, '')}/`;
export const DOCJOB_MOBILE_USER_AGENT =
  `${DOCJOB_MOBILE_USER_AGENT_TOKEN}/${APP_VERSION}`;

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
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <View style={styles.errorOverlay} testID="web-shell-error">
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Не удалось открыть DocJob</Text>
        <Text style={styles.errorDescription}>
          Проверьте интернет-соединение и попробуйте снова.
        </Text>
        <Text style={styles.errorDetails} numberOfLines={2}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryPressed]}
          testID="web-shell-retry"
        >
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
        <Text style={styles.versionText}>
          Версия {APP_VERSION} ({ANDROID_VERSION_CODE})
        </Text>
      </View>
    </View>
  );
}

/**
 * The application is a hardened native shell around the responsive web
 * product. Users and reviewers therefore share the exact same pages, forms,
 * validation and capabilities with the browser version.
 */
export function WebAppShell() {
  const webViewRef = useRef<WebView | null>(null);
  const canGoBackRef = useRef(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);

  const source = useMemo(() => ({ uri: DOCJOB_WEB_APP_URL }), []);

  useEffect(() => {
    // Version 1.0 used bearer/refresh tokens in SecureStore. The unified web
    // surface uses HttpOnly cookies, so revoke and remove any legacy token
    // family during the in-place APK upgrade.
    void clearLegacyNativeSession();
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
    setError(null);
    setLoadProgress(0);
    setWebViewKey((current) => current + 1);
  }, []);

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
            }}
            onLoadStart={() => {
              setError(null);
              setLoadProgress(0);
            }}
            onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
            onLoadEnd={() => setLoadProgress(1)}
            onError={({ nativeEvent }) => {
              setError(nativeEvent.description || 'Ошибка сети');
            }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            cacheEnabled
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
            textZoom={100}
            androidLayerType="hardware"
            downloadingMessage="Файл загружается…"
            lackPermissionToDownloadMessage="Не удалось сохранить файл"
            style={styles.webView}
            testID="docjob-web-app"
          />

          {loadProgress < 1 && !error ? (
            <View pointerEvents="none" style={styles.loadingOverlay} testID="web-shell-loading">
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : null}

          {loadProgress > 0 && loadProgress < 1 && !error ? (
            <View
              pointerEvents="none"
              style={[styles.progress, { width: `${Math.max(8, loadProgress * 100)}%` }]}
            />
          ) : null}

          {error ? <NativeError message={error} onRetry={retry} /> : null}
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  errorCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    padding: 24,
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
  retryButton: {
    marginTop: 20,
    minWidth: 160,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  retryPressed: {
    opacity: 0.8,
  },
  retryText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  versionText: {
    marginTop: 18,
    color: colors.textSubtle,
    fontSize: 11,
  },
});
