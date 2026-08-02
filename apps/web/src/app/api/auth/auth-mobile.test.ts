/**
 * Integration tests for the mobile-transport auth endpoints (SP-4a T5):
 * token-in-body login/refresh/logout + Bearer-first `/me`. Run against the
 * real dev Postgres, same harness `packages/auth`'s `refresh.service.test.ts`
 * and `apps/web`'s `request-auth.test.ts` use (`DATABASE_URL` loaded via
 * `dotenv -e ../../.env.local -e ../../.env` in this package's `test`
 * script). Each test creates its own throwaway APPROVED user and cleans it
 * up in `afterEach` — `RefreshToken` rows cascade-delete with the user.
 *
 * These call the route handlers' exported `POST`/`GET` directly with
 * hand-built `NextRequest`s rather than going over real HTTP — the same
 * pattern `src/lib/request-auth.test.ts` uses for `getUserFromRequest`.
 *
 * Web cookie behavior is asserted to be unaffected by spot-checking that a
 * successful login/refresh still sets the httpOnly cookies via `Set-Cookie`
 * — the mobile-transport additions are additive, not a replacement.
 *
 * SP-4a-followup (security fix): raw tokens in the JSON body are now
 * native-only. The discriminators are XSS-safe by construction — an
 * `Origin` header is browser-set and cannot be forged/stripped by page JS,
 * and an XSS cannot read the httpOnly refresh cookie to relay it in a
 * body/header refresh call. The mobile requests below deliberately carry no
 * `Origin` header and present the refresh token via body/header (not
 * cookie), so they stay on the native path and keep getting body tokens.
 * The new "web transport" tests below add the other half: an `Origin`
 * header on login, and a cookie-sourced token on refresh, must each yield
 * `{ user }` only, with the httpOnly cookies still rotating.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@docjob/db';
import { hashPassword, hashRefreshToken } from '@docjob/auth';
import { DOCJOB_MOBILE_USER_AGENT_TOKEN } from '@docjob/types';
import { POST as loginPOST } from './login/route';
import { POST as refreshPOST } from './refresh/route';
import { POST as logoutPOST } from './logout/route';
import { GET as mePOST } from './me/route';

const PASSWORD = 'auth-mobile-test-password-123!';

// Matches AUTH_URL as loaded from repo-root .env.local for this test run
// (see apps/web/package.json's `test` script) — `assertSameOrigin`/
// `allowedOrigin` in `@/lib/csrf` compare an incoming `Origin` header
// against `new URL(AUTH_URL).origin`.
const WEB_ORIGIN = 'http://localhost:3000';

function uniqueEmail(tag: string): string {
  return `auth-mobile-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
}

function jsonRequest(url: string, body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type LoginBody = {
  user: { id: string };
  access: string;
  refresh: string;
  refreshExpiresAt: string;
};

describe('mobile-transport auth endpoints (integration, real Postgres)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function makeApprovedUser(role: 'ADMIN' | 'DOCTOR' | 'REVIEWER' = 'DOCTOR') {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail('login'),
        passwordHash: await hashPassword(PASSWORD),
        name: 'Auth Mobile Test User',
        role,
        approvedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function loginAs(email: string): Promise<LoginBody> {
    const req = jsonRequest('https://example.test/api/auth/login', { email, password: PASSWORD });
    const res = await loginPOST(req);
    expect(res.status).toBe(200);
    return (await res.json()) as LoginBody;
  }

  it('login returns access + refresh + refreshExpiresAt in the JSON body, and still sets the web cookies', async () => {
    const user = await makeApprovedUser();
    const req = jsonRequest('https://example.test/api/auth/login', { email: user.email, password: PASSWORD });
    const res = await loginPOST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginBody;

    expect(body.user.id).toBe(user.id);
    expect(typeof body.access).toBe('string');
    expect(body.access.split('.')).toHaveLength(3); // JWT (header.payload.sig)
    expect(typeof body.refresh).toBe('string');
    expect(body.refresh.length).toBeGreaterThan(0);
    expect(body.refreshExpiresAt).toBeTruthy();

    // Additive, not a replacement: the web cookie flow is unchanged.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/docjob-access=/);
    expect(setCookie).toMatch(/docjob-refresh=/);
  });

  it('rejects ADMIN from the embedded mobile surface without issuing tokens or cookies', async () => {
    const user = await makeApprovedUser('ADMIN');
    const req = jsonRequest(
      'https://example.test/api/auth/login',
      { email: user.email, password: PASSWORD },
      {
        origin: WEB_ORIGIN,
        'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
      },
    );
    const res = await loginPOST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'unsupported_role' });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('keeps desktop web ADMIN login unchanged', async () => {
    const user = await makeApprovedUser('ADMIN');
    const req = jsonRequest(
      'https://example.test/api/auth/login',
      { email: user.email, password: PASSWORD },
      { origin: WEB_ORIGIN, 'user-agent': 'Mozilla/5.0 desktop-browser' },
    );
    const res = await loginPOST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; role: string } };
    expect(body.user).toMatchObject({ id: user.id, role: 'ADMIN' });
    expect(res.headers.get('set-cookie')).toMatch(/docjob-access=/);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('login forwards an optional deviceLabel through to the issued refresh-token family', async () => {
    const user = await makeApprovedUser();
    const req = jsonRequest('https://example.test/api/auth/login', {
      email: user.email,
      password: PASSWORD,
      deviceLabel: 'integration-test-device',
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LoginBody;

    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(body.refresh) },
    });
    expect(row?.deviceLabel).toBe('integration-test-device');
  });

  it('login with an Origin header (web transport) returns only { user } in the body — no raw tokens — while still setting cookies', async () => {
    const user = await makeApprovedUser();
    const req = jsonRequest(
      'https://example.test/api/auth/login',
      { email: user.email, password: PASSWORD },
      { origin: WEB_ORIGIN },
    );
    const res = await loginPOST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect((body.user as { id: string }).id).toBe(user.id);
    expect(body.access).toBeUndefined();
    expect(body.refresh).toBeUndefined();
    expect(body.refreshExpiresAt).toBeUndefined();

    // The cookies still get set — only the JSON body's raw-token fields are
    // withheld for the web transport.
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/docjob-access=/);
    expect(setCookie).toMatch(/docjob-refresh=/);
  });

  it('refresh presented via the cookie (web transport) returns only { user } in the body — no raw tokens — while still rotating cookies', async () => {
    const user = await makeApprovedUser();
    const loginReq = jsonRequest(
      'https://example.test/api/auth/login',
      { email: user.email, password: PASSWORD },
      { origin: WEB_ORIGIN },
    );
    const loginRes = await loginPOST(loginReq);
    expect(loginRes.status).toBe(200);
    const refreshCookieValue = loginRes.cookies.get('docjob-refresh')?.value;
    expect(refreshCookieValue).toBeTruthy();

    // Presented via the `cookie` header (no body token at all) plus a
    // matching `Origin`, exactly like a real browser's same-origin fetch —
    // this is the shape an XSS'd page cannot forge, since it can't read the
    // httpOnly cookie value to relay elsewhere.
    const refreshReq = new NextRequest('https://example.test/api/auth/refresh', {
      method: 'POST',
      headers: {
        cookie: `docjob-refresh=${refreshCookieValue}`,
        origin: WEB_ORIGIN,
      },
    });
    const refreshRes = await refreshPOST(refreshReq);

    expect(refreshRes.status).toBe(200);
    const data = (await refreshRes.json()) as Record<string, unknown>;
    expect((data.user as { id: string }).id).toBe(user.id);
    expect(data.access).toBeUndefined();
    expect(data.refresh).toBeUndefined();
    expect(data.refreshExpiresAt).toBeUndefined();

    const setCookie = refreshRes.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/docjob-access=/);
    expect(setCookie).toMatch(/docjob-refresh=/);
  });

  it('GET /api/auth/me resolves the user from Authorization: Bearer <access from login>', async () => {
    const user = await makeApprovedUser();
    const { access } = await loginAs(user.email);

    const req = new NextRequest('https://example.test/api/auth/me', {
      headers: { authorization: `Bearer ${access}` },
    });
    const res = await mePOST(req);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { id: string } | null };
    expect(data.user?.id).toBe(user.id);
  });

  it('GET /api/auth/me clears a session when approval is revoked after login', async () => {
    const user = await makeApprovedUser();
    const { access } = await loginAs(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { approvedAt: null },
    });

    const req = new NextRequest('https://example.test/api/auth/me', {
      headers: { authorization: `Bearer ${access}` },
    });
    const res = await mePOST(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      user: null,
      status: 'session_invalid',
    });
    expect(res.headers.get('set-cookie')).toMatch(/docjob-access=;/);
  });

  it('GET /api/auth/me blocks mobile access after the database role changes to ADMIN', async () => {
    const user = await makeApprovedUser('DOCTOR');
    const { access } = await loginAs(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });

    const req = new NextRequest('https://example.test/api/auth/me', {
      headers: {
        authorization: `Bearer ${access}`,
        'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
      },
    });
    const res = await mePOST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      user: null,
      status: 'unsupported_role',
    });
    expect(res.headers.get('set-cookie')).toMatch(/docjob-access=;/);
  });

  it('GET /api/auth/me returns { user: null } with neither a Bearer header nor a cookie', async () => {
    const req = new NextRequest('https://example.test/api/auth/me');
    const res = await mePOST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
  });

  it('refresh accepts { refresh } in the body (no cookie) and returns a NEW access + refresh', async () => {
    const user = await makeApprovedUser();
    const { refresh } = await loginAs(user.email);

    const req = jsonRequest('https://example.test/api/auth/refresh', { refresh });
    const res = await refreshPOST(req);

    expect(res.status).toBe(200);
    const data = (await res.json()) as LoginBody;

    expect(data.user.id).toBe(user.id);
    expect(typeof data.access).toBe('string');
    expect(typeof data.refresh).toBe('string');
    expect(data.refresh).not.toBe(refresh);
    expect(data.refreshExpiresAt).toBeTruthy();

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/docjob-access=/);
    expect(setCookie).toMatch(/docjob-refresh=/);
  });

  it('refresh also accepts the X-Refresh-Token header (no body, no cookie)', async () => {
    const user = await makeApprovedUser();
    const { refresh } = await loginAs(user.email);

    const req = new NextRequest('https://example.test/api/auth/refresh', {
      method: 'POST',
      headers: { 'x-refresh-token': refresh },
    });
    const res = await refreshPOST(req);

    expect(res.status).toBe(200);
    const data = (await res.json()) as LoginBody;
    expect(data.refresh).not.toBe(refresh);
  });

  it('refresh revokes an ADMIN family instead of restoring it in the mobile surface', async () => {
    const user = await makeApprovedUser('ADMIN');
    const { refresh } = await loginAs(user.email);

    const req = jsonRequest(
      'https://example.test/api/auth/refresh',
      { refresh },
      {
        'user-agent': `Mozilla/5.0 ${DOCJOB_MOBILE_USER_AGENT_TOKEN}/1.1.0`,
      },
    );
    const res = await refreshPOST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: 'unsupported_role' });
    expect(res.headers.get('set-cookie')).toMatch(/docjob-access=;/);

    const family = await prisma.refreshToken.findMany({
      where: { userId: user.id },
      select: { revokedAt: true, revokeReason: true },
    });
    expect(family.length).toBeGreaterThan(0);
    expect(family.every((token) => token.revokedAt !== null)).toBe(true);
    expect(family.every((token) => token.revokeReason === 'unsupported-mobile-role')).toBe(true);
  });

  it('refresh with neither cookie, body, nor header returns 401', async () => {
    const req = new NextRequest('https://example.test/api/auth/refresh', { method: 'POST' });
    const res = await refreshPOST(req);
    expect(res.status).toBe(401);
  });

  it('logout with { refresh } in the body revokes the family; a subsequent refresh with that token fails', async () => {
    const user = await makeApprovedUser();
    const { refresh } = await loginAs(user.email);

    const logoutReq = jsonRequest('https://example.test/api/auth/logout', { refresh });
    const logoutRes = await logoutPOST(logoutReq);
    expect(logoutRes.status).toBe(200);
    expect(await logoutRes.json()).toEqual({ ok: true });

    const refreshReq = jsonRequest('https://example.test/api/auth/refresh', { refresh });
    const refreshRes = await refreshPOST(refreshReq);
    expect(refreshRes.status).toBe(401);
  });

  it(
    'reuse of a superseded refresh token (outside the grace window) durably revokes the family, ' +
      'while a fresh, unrotated token still rotates successfully',
    async () => {
      const user = await makeApprovedUser();
      const { refresh: original } = await loginAs(user.email);

      // Rotate once — the "a valid rotation yields 200" half of the durable
      // property the brief asks for.
      const firstRotateRes = await refreshPOST(
        jsonRequest('https://example.test/api/auth/refresh', { refresh: original }),
      );
      expect(firstRotateRes.status).toBe(200);
      const { refresh: rotatedOnce } = (await firstRotateRes.json()) as LoginBody;

      // Simulate the reuse presentation happening well outside
      // `rotateRefresh`'s 10s grace window by backdating the superseded
      // row's `replacedAt` directly, rather than sleeping >10s in the test —
      // a timing-fragile "present twice instantly" assertion is exactly
      // what the brief says to avoid.
      await prisma.refreshToken.update({
        where: { tokenHash: hashRefreshToken(original) },
        data: { replacedAt: new Date(Date.now() - 60_000) },
      });

      // Presenting the now-stale original again is a reuse outside grace:
      // a durable 401, and the whole family is revoked as a side effect.
      const reuseRes = await refreshPOST(
        jsonRequest('https://example.test/api/auth/refresh', { refresh: original }),
      );
      expect(reuseRes.status).toBe(401);

      // The family is revoked, so even the most-recently-issued
      // (previously still-valid) token no longer works either — the
      // durable, eventual-401 property the brief asks for.
      const rotatedTokenRes = await refreshPOST(
        jsonRequest('https://example.test/api/auth/refresh', { refresh: rotatedOnce }),
      );
      expect(rotatedTokenRes.status).toBe(401);
    },
  );
});
