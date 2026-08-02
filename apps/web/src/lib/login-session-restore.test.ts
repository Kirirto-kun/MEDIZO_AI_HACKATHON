import { describe, expect, it } from 'vitest';
import {
  LOGIN_SESSION_RESTORE_TIMEOUT_MS,
  shouldAttemptSessionRestore,
} from './login-session-restore';

const clearFlags = {
  justRegistered: false,
  mobileAdminBlocked: false,
  recovered: false,
  mobileRecovery: false,
  mobileRecoveryDone: false,
  skipRestore: false,
};

describe('login session restoration', () => {
  it('keeps restoration bounded so the login form cannot remain blocked forever', () => {
    expect(LOGIN_SESSION_RESTORE_TIMEOUT_MS).toBe(5_000);
  });

  it('attempts restoration on a normal login visit', () => {
    expect(shouldAttemptSessionRestore(clearFlags)).toBe(true);
  });

  it.each([
    'justRegistered',
    'mobileAdminBlocked',
    'recovered',
    'mobileRecovery',
    'mobileRecoveryDone',
    'skipRestore',
  ] as const)(
    'shows the login form immediately when %s is set',
    (flag) => {
      expect(shouldAttemptSessionRestore({ ...clearFlags, [flag]: true })).toBe(false);
    },
  );
});
