import { NextRequest, NextResponse } from 'next/server';
import { rotateRefresh, revokeFamily, signAccessToken } from '@docjob/auth';
import * as core from '@docjob/core';
import { isDocJobMobileUserAgent } from '@docjob/types';
import { assertSameOrigin } from '@/lib/csrf';
import {
  getRefreshToken,
  getRefreshTokenFromRequest,
  setAuthCookies,
  clearAuthCookies,
} from '@/lib/auth-cookies';
import { signingKey } from '@/lib/auth-keys';

// Node runtime: rotates the refresh token in Postgres and (on success)
// signs a fresh access JWT — not Edge-safe.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const csrfFailure = assertSameOrigin(req);
  if (csrfFailure) return csrfFailure;

  // The token SOURCE (not just its value) determines the transport: a web
  // client's refresh token always comes from the httpOnly cookie, which an
  // XSS'd page cannot read — so it can never assemble a body/header
  // request. Checked from the cookie jar directly (no body read), so this
  // is safe to evaluate before consuming the request body below.
  const fromCookie = Boolean(getRefreshToken(req.cookies));

  // Cookie first (web, unchanged), then body `{ refresh }` / `X-Refresh-Token`
  // header (mobile/native — never carries a cookie at all).
  const raw = await getRefreshTokenFromRequest(req);
  if (!raw) {
    const res = NextResponse.json({ error: 'No refresh token' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  const rotated = await rotateRefresh(raw);
  if (!rotated || 'revoked' in rotated) {
    const res = NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }

  // Re-read the user from the DB rather than trusting anything cached — an
  // admin may have de-approved this account since the refresh token was
  // issued, and that must take effect on the very next refresh, not just on
  // next login.
  const user = await core.users.getUserById(rotated.userId);
  if (!user || !user.approvedAt) {
    await revokeFamily(rotated.familyId, 'user-not-approved');
    const res = NextResponse.json({ error: 'Account not approved' }, { status: 401 });
    clearAuthCookies(res);
    return res;
  }
  if (
    user.role === 'ADMIN' &&
    isDocJobMobileUserAgent(req.headers.get('user-agent'))
  ) {
    await revokeFamily(rotated.familyId, 'unsupported-mobile-role');
    const res = NextResponse.json(
      { status: 'unsupported_role' },
      { status: 403 },
    );
    clearAuthCookies(res);
    return res;
  }

  const access = await signAccessToken(
    { sub: user.id, role: user.role, approvedAt: user.approvedAt },
    signingKey(),
  );

  // The rotated tokens are returned in the JSON body ONLY when the
  // presented token did NOT come from the cookie — i.e. a native/mobile
  // client presenting it via body or `X-Refresh-Token` header, which has no
  // cookie jar to read the new one from. A web client's request is
  // necessarily cookie-sourced (that's the only place its browser ever put
  // the token), so it gets `{ user }` only: an XSS forcing a cookie-based
  // refresh call cannot read a token it can't read from the cookie AND
  // can't read from the response body either. Still the single rotation
  // performed above — the `newRaw` handed to the client here is the only
  // copy that will ever work (the old raw is now single-use-spent), and the
  // cookies are rotated unconditionally regardless of transport.
  const res = NextResponse.json({
    user,
    ...(fromCookie
      ? {}
      : {
          access,
          refresh: rotated.newRaw,
          refreshExpiresAt: rotated.expiresAt,
        }),
  });
  setAuthCookies(res, {
    access,
    refresh: rotated.newRaw,
    refreshExpiresAt: rotated.expiresAt,
  });
  return res;
}
