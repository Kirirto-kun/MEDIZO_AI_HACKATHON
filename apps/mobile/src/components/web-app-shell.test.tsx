import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import {
  classifyNavigation,
  DOCJOB_MOBILE_USER_AGENT,
  DOCJOB_WEB_APP_URL,
  handleAndroidBack,
  handleOpenWindow,
  WebAppShell,
} from './web-app-shell';
import { logout as clearLegacyNativeSession } from '../lib/auth-client';

jest.mock('../lib/auth-client', () => ({
  __esModule: true,
  logout: jest.fn(async () => undefined),
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
        }));
        return React.createElement(View, props);
      },
    ),
  };
});

const mockedClearLegacyNativeSession =
  clearLegacyNativeSession as jest.MockedFunction<typeof clearLegacyNativeSession>;

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

describe('WebAppShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts the production web surface with cookies, file support and a versioned marker', async () => {
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
    await waitFor(() => expect(mockedClearLegacyNativeSession).toHaveBeenCalledTimes(1));
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
});
