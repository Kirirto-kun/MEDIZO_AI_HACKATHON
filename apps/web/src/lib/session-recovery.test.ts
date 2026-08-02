import { describe, expect, it, vi } from 'vitest';
import { runSessionRecovery } from './session-recovery';

describe('runSessionRecovery', () => {
  it('logs out, clears local state and navigates to login in order', async () => {
    const calls: string[] = [];

    await runSessionRecovery({
      logout: async () => {
        calls.push('logout');
      },
      clearClientState: () => {
        calls.push('clear');
      },
      navigateToLogin: () => {
        calls.push('navigate');
      },
    });

    expect(calls).toEqual(['logout', 'clear', 'navigate']);
  });

  it('still navigates when server logout and browser storage cleanup fail', async () => {
    const navigateToLogin = vi.fn();

    await runSessionRecovery({
      logout: async () => {
        throw new Error('network unavailable');
      },
      clearClientState: () => {
        throw new Error('storage unavailable');
      },
      navigateToLogin,
    });

    expect(navigateToLogin).toHaveBeenCalledOnce();
  });
});
