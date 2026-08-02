export const LOGIN_SESSION_RESTORE_TIMEOUT_MS = 5_000;

export type LoginSessionRestoreFlags = {
  justRegistered: boolean;
  mobileAdminBlocked: boolean;
  recovered: boolean;
  mobileRecovery: boolean;
  mobileRecoveryDone: boolean;
  skipRestore: boolean;
};

/**
 * Session restoration is a convenience only. Recovery and explicit opt-out
 * URLs must always expose the login form immediately instead of risking a
 * redirect/spinner loop.
 */
export function shouldAttemptSessionRestore(flags: LoginSessionRestoreFlags): boolean {
  return !(
    flags.justRegistered ||
    flags.mobileAdminBlocked ||
    flags.recovered ||
    flags.mobileRecovery ||
    flags.mobileRecoveryDone ||
    flags.skipRestore
  );
}
