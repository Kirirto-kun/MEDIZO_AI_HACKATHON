import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import {
  classifyNavigation,
  DOCJOB_LOGIN_URL,
  DOCJOB_MOBILE_USER_AGENT,
  DOCJOB_WEB_APP_URL,
  handleAndroidBack,
  handleOpenWindow,
  isMainDocumentHttpError,
  parseShellMessage,
  WEB_RECOVERY_LOGOUT_SCRIPT,
  WEB_RECOVERY_STORAGE_SCRIPT,
  WEB_RUNTIME_MONITOR_SCRIPT,
  WebAppShell,
} from './web-app-shell';
import { clearLegacyMobileState } from '../lib/recovery';

jest.mock('../lib/recovery', () => ({
  __esModule: true,
  clearLegacyMobileState: jest.fn(async () => undefined),
}));

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'safe-area' }, children),
  };
});

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: React.forwardRef(
      function MockWebView(
        props: Record<string, unknown> & { testID?: string },
        ref: React.ForwardedRef<unknown>,
      ) {
        React.useImperativeHandle(ref, () => ({
          goBack: jest.fn(),
          stopLoading: jest.fn(),
          clearFormData: jest.fn(),
          clearHistory: jest.fn(),
          clearCache: jest.fn(),
        }));
        return React.createElement(View, props);
      },
    ),
  };
});

const mockedClearLegacyMobileState =
  clearLegacyMobileState as jest.MockedFunction<typeof clearLegacyMobileState>;

describe('classifyNavigation', () => {
  const appUrl = 'https://docjob.kz/';

  it('keeps only the exact DocJob origin inside the application', () => {
    expect(classifyNavigation('https://docjob.kz/register', appUrl)).toBe('internal');
    expect(classifyNavigation('/profile', appUrl)).toBe('internal');
    expect(classifyNavigation('blob:https://docjob.kz/123', appUrl)).toBe('internal');
    expect(classifyNavigation('https://docjob.kz.evil.example/login', appUrl)).toBe('external');
  });

  it('opens only ordinary external links and blocks unsafe schemes', () => {
    expect(classifyNavigation('https://example.org/article', appUrl)).toBe('external');
    expect(classifyNavigation('mailto:support@docjob.kz', appUrl)).toBe('external');
    expect(classifyNavigation('tel:+77000000000', appUrl)).toBe('external');
    expect(classifyNavigation('javascript:alert(1)', appUrl)).toBe('blocked');
    expect(classifyNavigation('intent://unsafe', appUrl)).toBe('blocked');
    expect(classifyNavigation('file:///etc/passwd', appUrl)).toBe('blocked');
  });
});

describe('handleAndroidBack', () => {
  it('navigates back inside web history and consumes that hardware event', () => {
    const goBack = jest.fn();
    expect(handleAndroidBack(true, goBack)).toBe(true);
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('lets Android close the app when the web history is already at its root', () => {
    const goBack = jest.fn();
    expect(handleAndroidBack(false, goBack)).toBe(false);
    expect(goBack).not.toHaveBeenCalled();
  });
});

describe('handleOpenWindow', () => {
  it('routes same-origin windows internally and safe external windows to the OS', () => {
    const openInternal = jest.fn();
    const openExternal = jest.fn();
    const appUrl = 'https://docjob.kz/';

    expect(
      handleOpenWindow(
        '/terms',
        openInternal,
        openExternal,
        appUrl,
      ),
    ).toBe('internal');
    expect(openInternal).toHaveBeenCalledWith('https://docjob.kz/terms');

    expect(
      handleOpenWindow(
        'https://example.org/help',
        openInternal,
        openExternal,
        appUrl,
      ),
    ).toBe('external');
    expect(openExternal).toHaveBeenCalledWith('https://example.org/help');
  });

  it('blocks unsafe popup schemes without invoking either destination', () => {
    const openInternal = jest.fn();
    const openExternal = jest.fn();

    expect(
      handleOpenWindow(
        'javascript:alert(1)',
        openInternal,
        openExternal,
        'https://docjob.kz/',
      ),
    ).toBe('blocked');
    expect(openInternal).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('native shell messages and main-document errors', () => {
  it('accepts only bounded messages from the DocJob native channel', () => {
    expect(
      parseShellMessage(
        JSON.stringify({
          channel: 'docjob-native-shell',
          type: 'runtime-error',
          message: 'React render failed',
        }),
      ),
    ).toEqual({ type: 'runtime-error', message: 'React render failed' });
    expect(
      parseShellMessage(
        JSON.stringify({
          channel: 'docjob-native-shell',
          type: 'logout-complete',
          ok: true,
        }),
      ),
    ).toEqual({ type: 'logout-complete', ok: true });
    expect(parseShellMessage('{not-json')).toBeNull();
    expect(
      parseShellMessage(
        JSON.stringify({ channel: 'application-page', type: 'runtime-error', message: 'x' }),
      ),
    ).toBeNull();
  });

  it('distinguishes a top-level HTTP failure from a failed subresource', () => {
    expect(
      isMainDocumentHttpError(
        'https://docjob.kz/profile#details',
        'https://docjob.kz/profile',
      ),
    ).toBe(true);
    expect(
      isMainDocumentHttpError(
        'https://docjob.kz/_next/static/app.js',
        'https://docjob.kz/profile',
      ),
    ).toBe(false);
    expect(
      isMainDocumentHttpError(
        'https://cdn.example.org/app.js',
        'https://docjob.kz/profile',
      ),
    ).toBe(false);
  });
});

describe('WebAppShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts a fresh production web surface with hardened mobile viewport settings', async () => {
    await render(<WebAppShell />);

    const webview = screen.getByTestId('docjob-web-app');
    expect(webview.props.source).toEqual({ uri: DOCJOB_WEB_APP_URL });
    expect(webview.props.applicationNameForUserAgent).toBe(DOCJOB_MOBILE_USER_AGENT);
    expect(DOCJOB_MOBILE_USER_AGENT).toContain('DocJobMobile/');
    expect(webview.props.javaScriptEnabled).toBe(true);
    expect(webview.props.domStorageEnabled).toBe(true);
    expect(webview.props.sharedCookiesEnabled).toBe(true);
    expect(webview.props.thirdPartyCookiesEnabled).toBe(false);
    expect(webview.props.allowFileAccess).toBe(false);
    expect(webview.props.setSupportMultipleWindows).toBe(true);
    expect(webview.props.onOpenWindow).toEqual(expect.any(Function));
    expect(webview.props.originWhitelist).toEqual(['*']);
    expect(webview.props.cacheEnabled).toBe(false);
    expect(webview.props.cacheMode).toBe('LOAD_NO_CACHE');
    expect(webview.props.androidLayerType).toBe('none');
    expect(webview.props.scalesPageToFit).toBe(true);
    expect(webview.props.showsHorizontalScrollIndicator).toBe(false);
    expect(webview.props.injectedJavaScriptBeforeContentLoaded).toContain(
      WEB_RUNTIME_MONITOR_SCRIPT.trim(),
    );
    expect(screen.getByTestId('web-shell-recovery-trigger')).toBeTruthy();
    await waitFor(() => expect(mockedClearLegacyMobileState).toHaveBeenCalledTimes(1));
  });

  it('keeps same-origin routes inside and opens safe external routes with the OS', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<WebAppShell />);
    const webview = screen.getByTestId('docjob-web-app');

    expect(
      webview.props.onShouldStartLoadWithRequest({
        url: `${DOCJOB_WEB_APP_URL}register`,
      }),
    ).toBe(true);
    expect(
      webview.props.onShouldStartLoadWithRequest({
        url: 'https://example.org/help',
      }),
    ).toBe(false);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://example.org/help'));

    expect(
      webview.props.onShouldStartLoadWithRequest({
        url: 'javascript:alert(1)',
      }),
    ).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('shows a retry screen after a network error and remounts the web surface', async () => {
    await render(<WebAppShell />);
    const first = screen.getByTestId('docjob-web-app');

    await act(async () => {
      first.props.onError({
        nativeEvent: { description: 'net::ERR_INTERNET_DISCONNECTED' },
      });
    });
    expect(screen.getByTestId('web-shell-error')).toBeTruthy();
    expect(screen.getByText('net::ERR_INTERNET_DISCONNECTED')).toBeTruthy();

    fireEvent.press(screen.getByTestId('web-shell-retry'));
    await waitFor(() => expect(screen.queryByTestId('web-shell-error')).toBeNull());
    expect(screen.getByTestId('docjob-web-app')).toBeTruthy();
  });

  it('surfaces uncaught web runtime errors and Android renderer crashes', async () => {
    await render(<WebAppShell />);
    const webview = screen.getByTestId('docjob-web-app');

    await act(async () => {
      webview.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            channel: 'docjob-native-shell',
            type: 'runtime-error',
            message: 'Minified React error',
          }),
        },
      });
    });
    expect(screen.getByText('Ошибка страницы: Minified React error')).toBeTruthy();

    fireEvent.press(screen.getByTestId('web-shell-retry'));
    const remounted = await screen.findByTestId('docjob-web-app');
    await act(async () => {
      remounted.props.onRenderProcessGone({ nativeEvent: { didCrash: true } });
    });
    expect(
      screen.getByText('Процесс отображения WebView аварийно завершился'),
    ).toBeTruthy();
  });

  it('shows an error only for a failing main document, not a failed asset', async () => {
    await render(<WebAppShell />);
    const webview = screen.getByTestId('docjob-web-app');

    await act(async () => {
      webview.props.onLoadStart({
        nativeEvent: { url: 'https://docjob.kz/profile' },
      });
      webview.props.onHttpError({
        nativeEvent: {
          statusCode: 500,
          url: 'https://docjob.kz/_next/static/app.js',
        },
      });
    });
    expect(screen.queryByTestId('web-shell-error')).toBeNull();

    await act(async () => {
      webview.props.onHttpError({
        nativeEvent: { statusCode: 503, url: 'https://docjob.kz/profile' },
      });
    });
    expect(screen.getByText('Сервер вернул ошибку 503')).toBeTruthy();
  });

  it('keeps recovery reachable on any page and resets into a cookie-free login', async () => {
    await render(<WebAppShell />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('web-shell-recovery-trigger'));
    });
    expect(await screen.findByTestId('web-shell-recovery-panel')).toBeTruthy();

    const panel = screen.getByTestId('web-shell-recovery-panel');
    expect(panel.props.contentContainerStyle).toEqual(
      expect.objectContaining({
        flexGrow: 1,
        paddingHorizontal: 16,
        paddingVertical: 20,
      }),
    );

    fireEvent.press(screen.getByTestId('web-shell-recovery-login-reset'));
    await waitFor(() => expect(screen.getByTestId('web-shell-resetting')).toBeTruthy());

    const logoutView = screen.getByTestId('docjob-web-app');
    expect(logoutView.props.source.uri).toContain('/login?mobileRecovery=1');
    expect(logoutView.props.incognito).toBe(false);
    expect(logoutView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      WEB_RECOVERY_LOGOUT_SCRIPT.trim(),
    );

    await act(async () => {
      logoutView.props.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            channel: 'docjob-native-shell',
            type: 'logout-complete',
            ok: true,
          }),
        },
      });
    });

    await waitFor(() => expect(screen.queryByTestId('web-shell-resetting')).toBeNull());
    const cleanLogin = screen.getByTestId('docjob-web-app');
    expect(cleanLogin.props.source.uri).toContain(DOCJOB_LOGIN_URL);
    expect(cleanLogin.props.source.uri).toContain('mobileRecoveryDone=1');
    expect(cleanLogin.props.incognito).toBe(false);
    expect(cleanLogin.props.cacheEnabled).toBe(false);
    expect(cleanLogin.props.injectedJavaScriptBeforeContentLoaded).toContain(
      WEB_RECOVERY_STORAGE_SCRIPT.trim(),
    );
    expect(mockedClearLegacyMobileState).toHaveBeenCalledTimes(2);
  });

  it('starts the same logout-to-clean-login recovery after a native root crash', async () => {
    await render(<WebAppShell startInRecoveryMode />);

    expect(screen.getByTestId('web-shell-resetting')).toBeTruthy();
    const logoutView = screen.getByTestId('docjob-web-app');
    expect(logoutView.props.source.uri).toContain('mobileRecovery=1');
    expect(logoutView.props.injectedJavaScriptBeforeContentLoaded).toContain(
      WEB_RECOVERY_LOGOUT_SCRIPT.trim(),
    );
  });

  it('reaches a clean login even when the old page cannot acknowledge logout', async () => {
    await render(<WebAppShell recoveryTimeoutMs={10} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('web-shell-recovery-trigger'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('web-shell-recovery-login-reset'));
    });

    await waitFor(() => expect(screen.queryByTestId('web-shell-resetting')).toBeNull());
    const cleanLogin = screen.getByTestId('docjob-web-app');
    expect(cleanLogin.props.incognito).toBe(true);
    expect(cleanLogin.props.source.uri).toContain('/login?mobileRecoveryDone=1');
  });
});
