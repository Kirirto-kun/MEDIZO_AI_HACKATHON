import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppErrorBoundary } from './app-error-boundary';
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
      React.createElement(View, null, children),
  };
});

const mockedClearState = clearLegacyMobileState as jest.MockedFunction<
  typeof clearLegacyMobileState
>;

function BrokenChild(): React.ReactNode {
  throw new Error('root render failed');
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps ordinary children unchanged', async () => {
    await render(
      <AppErrorBoundary onRecover={jest.fn()}>
        <Text>Рабочий экран</Text>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('Рабочий экран')).toBeTruthy();
    expect(screen.queryByTestId('native-crash-recovery')).toBeNull();
  });

  it('clears local state and delegates a clean-login remount after a root crash', async () => {
    const onRecover = jest.fn();
    await render(
      <AppErrorBoundary onRecover={onRecover}>
        <BrokenChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId('native-crash-recovery')).toBeTruthy();
    expect(screen.getByText('root render failed')).toBeTruthy();

    fireEvent.press(screen.getByTestId('native-crash-login-reset'));

    await waitFor(() => expect(mockedClearState).toHaveBeenCalledTimes(1));
    expect(onRecover).toHaveBeenCalledTimes(1);
  });
});
