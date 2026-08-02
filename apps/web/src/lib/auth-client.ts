'use client';

/**
 * Client-side fetch wrapper for calls to our own `/api/*` routes, with a
 * single-flight 401 → refresh → retry interceptor.
 *
 * Why this exists: access tokens are short-lived (~15m, see
 * `packages/auth/src/tokens.ts`'s `DEFAULT_TTL_SECONDS`) and middleware never
 * refreshes them itself (see `@/middleware.ts`'s `isAuthenticated` doc
 * comment) — that's deliberately left to the client. Without this wrapper,
 * any authenticated fetch issued more than ~15 minutes after the last
 * login/refresh would 401 outright instead of transparently recovering.
 *
 * Single-flight: if several `authFetch` calls hit a 401 around the same
 * time (e.g. a page fires off multiple protected requests at once), they
 * must not each independently POST `/api/auth/refresh` — concurrent
 * `rotateRefresh` calls would only let the first succeed (the raw refresh
 * token is single-use; see `packages/auth/src/refresh.service.ts`'s reuse
 * detection) and the rest would be treated as replay/reuse and revoke the
 * whole family, forcing every caller back to `/login`. `refreshInFlight`
 * below is a shared, module-scoped promise so concurrent callers all await
 * the same one refresh attempt.
 */

let refreshInFlight: Promise<boolean> | null = null;

export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A stalled mobile connection must settle as an error instead of leaving a
 * React Query screen in an infinite loading state. Preserve a caller-provided
 * AbortSignal while adding the application's own upper bound.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetchWithTimeout(
      '/api/auth/refresh',
      { method: 'POST', credentials: 'same-origin' },
      5_000,
    )
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const callbackUrl = window.location.pathname + window.location.search;
  window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

/**
 * Drop-in replacement for `fetch` when calling our own authenticated
 * `/api/*` routes from client components. On a `401` it attempts exactly one
 * shared refresh (see `refreshAccessToken` above) and retries the original
 * request once with the freshly rotated cookies attached. If the refresh
 * itself fails (refresh token expired, revoked, or reused), it redirects to
 * `/login` with the current path as `callbackUrl` and returns the original
 * (still-401) response — callers that are about to navigate away don't need
 * to branch on that, but callers that want to react to a bounce-in-progress
 * still get a rejected/failed response to short-circuit on.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const first = await fetchWithTimeout(input, init);
  if (first.status !== 401) return first;

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    redirectToLogin();
    return first;
  }

  return fetchWithTimeout(input, init);
}
