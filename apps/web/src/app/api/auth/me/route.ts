import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@docjob/auth';
import * as core from '@docjob/core';
import { isDocJobMobileUserAgent } from '@docjob/types';
import { clearAuthCookies, getAccessToken } from '@/lib/auth-cookies';
import { bearerToken } from '@/lib/session';
import { verificationKeys } from '@/lib/auth-keys';

// Node runtime: re-reads the user from Postgres after verifying the JWT
// (jose itself is Edge-safe, but the DB round trip isn't — this route is
// the client session source for Task 6's cutover, not the Edge middleware
// check, so Node here is fine).
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Bearer first (mobile/native — no cookies at all), falling back to the
  // access cookie (web). Reuses the same bearer-parse helper `@/lib/session`
  // exports for `getUserFromRequest` (A4/T4) rather than re-implementing it
  // here — this route still re-serializes via `core.users.getUserById`
  // below (not `getUserFromRequest` itself), since that helper resolves to
  // the raw Prisma `User` row and this endpoint's contract is the
  // `SerializedUser` shape.
  const token = bearerToken(req) ?? getAccessToken(req.cookies);
  if (!token) {
    return NextResponse.json({ user: null });
  }

  const claims = await verifyAccessToken(token, verificationKeys());
  if (!claims) {
    return NextResponse.json({ user: null });
  }

  const user = await core.users.getUserById(claims.sub);
  // Access JWTs are intentionally short lived, but approval can be revoked
  // while one is still valid. Fail closed immediately instead of returning a
  // de-approved profile that the UI would try to render while every protected
  // API call rejects it. This also heals stale/corrupt browser sessions by
  // clearing both cookies and letting the client return to login.
  if (!user || !user.approvedAt) {
    const res = NextResponse.json(
      { user: null, status: 'session_invalid' },
      { status: 401 },
    );
    clearAuthCookies(res);
    return res;
  }
  // Re-check the current database role instead of trusting the short-lived
  // JWT claim. This closes the role-change window where a user promoted to
  // ADMIN could otherwise keep rendering an already-open mobile session.
  if (
    user.role === 'ADMIN' &&
    isDocJobMobileUserAgent(req.headers.get('user-agent'))
  ) {
    const res = NextResponse.json(
      { user: null, status: 'unsupported_role' },
      { status: 403 },
    );
    clearAuthCookies(res);
    return res;
  }
  return NextResponse.json({ user });
}
