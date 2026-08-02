export type SessionRecoveryActions = {
  logout: () => Promise<void>;
  clearClientState: () => Promise<void> | void;
  navigateToLogin: () => void;
};

/**
 * Last-resort recovery for a broken authenticated surface.
 *
 * Navigation is deliberately guaranteed even when the logout endpoint or
 * browser storage cleanup fails. A user must never remain trapped on an error
 * screen because one of the cleanup steps is unavailable.
 */
export async function runSessionRecovery(actions: SessionRecoveryActions): Promise<void> {
  try {
    await actions.logout();
  } catch {
    // Continue with local cleanup and navigation when the API is unavailable.
  }

  try {
    await actions.clearClientState();
  } catch {
    // Navigation is the final invariant, even with corrupt/unavailable storage.
  }

  actions.navigateToLogin();
}

async function clearBrowserState(): Promise<void> {
  try {
    window.localStorage.clear();
  } catch {
    // Storage may be disabled or corrupt inside an embedded browser.
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Same as above: recovery must remain best-effort.
  }

  if ('caches' in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name)));
    } catch {
      // Cache Storage is optional and may be unavailable in private/WebView mode.
    }
  }
}

/** Clear the server session plus potentially corrupt client state and log in anew. */
export async function recoverBrowserSession(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);

  await runSessionRecovery({
    logout: async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    },
    clearClientState: clearBrowserState,
    navigateToLogin: () => window.location.replace('/login?recovered=1'),
  });
}
