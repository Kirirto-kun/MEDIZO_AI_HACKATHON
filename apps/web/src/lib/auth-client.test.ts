import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_REQUEST_TIMEOUT_MS, authFetch } from './auth-client';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authFetch network timeout', () => {
  it('aborts a stalled request so query screens can leave their loading state', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = authFetch('/api/trpc/cases.list');
    const rejection = expect(request).rejects.toThrow('request aborted');
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);

    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
  });
});
