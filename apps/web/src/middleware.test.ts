import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DOCJOB_MOBILE_USER_AGENT_TOKEN } from '@docjob/types';

vi.mock('@docjob/auth/tokens', () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('@/lib/auth-keys', () => ({
  verificationKeys: vi.fn(),
}));

import middleware from './middleware';
import { verifyAccessToken } from '@docjob/auth/tokens';

const ACCESS_COOKIES = 'docjob-access=test-token; __Host-docjob-access=test-token';

beforeEach(() => {
  vi.mocked(verifyAccessToken).mockReset();
});

describe('middleware public metadata routes', () => {
  it.each(['/robots.txt', '/sitemap.xml'])(
    'allows anonymous access to %s without redirecting to login',
    async (pathname) => {
      const request = new NextRequest(`https://docjob.kz${pathname}`);
      const response = await middleware(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );
});

describe('middleware embedded-mobile role gate', () => {
  it('opens login instead of the marketing landing page for an unauthenticated mobile shell', async () => {
    const request = new NextRequest('https://docjob.kz/', {
      headers: {
        'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://docjob.kz/login?callbackUrl=%2F',
    );
  });

  it('keeps the public landing page as the desktop root', async () => {
    const request = new NextRequest('https://docjob.kz/', {
      headers: { 'user-agent': 'Mozilla/5.0 desktop-browser' },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://docjob.kz/landing');
  });

  it('redirects an existing mobile ADMIN session to a reasoned login and clears auth cookies', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'admin-id',
      role: 'ADMIN',
      approvedAt: new Date().toISOString(),
    });
    const request = new NextRequest('https://docjob.kz/', {
      headers: {
        cookie: ACCESS_COOKIES,
        'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://docjob.kz/login?mobileAdmin=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('set-cookie')).toMatch(/docjob-access=/);
    expect(response.headers.get('set-cookie')).toMatch(/docjob-refresh=/);
  });

  it('does not block the same ADMIN session in a desktop browser', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      sub: 'admin-id',
      role: 'ADMIN',
      approvedAt: new Date().toISOString(),
    });
    const request = new NextRequest('https://docjob.kz/', {
      headers: { cookie: ACCESS_COOKIES, 'user-agent': 'Mozilla/5.0 desktop-browser' },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });

  it.each(['DOCTOR', 'REVIEWER'] as const)(
    'keeps mobile %s access unchanged',
    async (role) => {
      vi.mocked(verifyAccessToken).mockResolvedValue({
        sub: `${role.toLowerCase()}-id`,
        role,
        approvedAt: new Date().toISOString(),
      });
      const request = new NextRequest('https://docjob.kz/', {
        headers: {
          cookie: ACCESS_COOKIES,
          'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
        },
      });

      const response = await middleware(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('location')).toBeNull();
    },
  );
});
