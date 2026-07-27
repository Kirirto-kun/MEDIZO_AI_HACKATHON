import { NextRequest, NextResponse } from 'next/server';
import { login, getLoginLimiter } from '@docjob/auth';
import { isDocJobMobileUserAgent } from '@docjob/types';
import { assertSameOrigin } from '@/lib/csrf';
import { setAuthCookies } from '@/lib/auth-cookies';
import { signingKey } from '@/lib/auth-keys';

// Node runtime: `auth.login` touches Prisma and runs an argon2id verify,
// neither of which is Edge-safe.
export const runtime = 'nodejs';

/**
 * Module-singleton limiter, mirroring `@docjob/auth`'s own default — kept
 * explicit here (rather than relying on that internal default) so the
 * limiter instance is unambiguous and test-visible from the web side. SP-5
 * T4: `getLoginLimiter()` picks a Redis-backed limiter when `REDIS_URL` is
 * set (so this route and every other web/worker instance share the same
 * lockout state), else the original in-process `Map`-backed one — see
 * `@docjob/auth`'s `rate-limit-redis.ts` / `rate-limit.ts`.
 */
const limiter = getLoginLimiter();

function clientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return '127.0.0.1';
}

export async function POST(req: NextRequest) {
  const csrfFailure = assertSameOrigin(req);
  if (csrfFailure) return csrfFailure;

  let body: { email?: unknown; password?: unknown; deviceLabel?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; password?: unknown; deviceLabel?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  const deviceLabel = typeof body.deviceLabel === 'string' ? body.deviceLabel : undefined;

  const result = await login(
    {
      email: body.email,
      password: body.password,
      ip: clientIp(req),
      deviceLabel,
      ...(isDocJobMobileUserAgent(req.headers.get('user-agent'))
        ? { allowedRoles: ['DOCTOR', 'REVIEWER'] as const }
        : {}),
    },
    signingKey(),
    limiter,
  );

  switch (result.status) {
    case 'ok': {
      // The body carries the raw tokens ONLY for a native/mobile client,
      // which never receives the httpOnly cookies at all and so has no
      // other way to obtain them. A browser POST always carries an `Origin`
      // header (it's a forbidden header page JS cannot set or strip), so
      // Origin-absence reliably identifies a native transport; a web
      // request (Origin present) gets `{ user }` only — the rotating
      // refresh token must live solely in the httpOnly cookie, unreadable
      // by an XSS'd page. Either way this is the SAME token pair minted
      // above, not a second mint: exactly one successful response ever
      // carries the raw refresh token, and only to native clients.
      const isNativeClient = !req.headers.get('origin');
      const res = NextResponse.json({
        user: result.user,
        ...(isNativeClient
          ? {
              access: result.access,
              refresh: result.refresh,
              refreshExpiresAt: result.refreshExpiresAt,
            }
          : {}),
      });
      setAuthCookies(res, {
        access: result.access,
        refresh: result.refresh,
        refreshExpiresAt: result.refreshExpiresAt,
      });
      return res;
    }
    case 'pending':
      // Credentials were correct but the account isn't admin-approved yet.
      // Never issues tokens.
      return NextResponse.json({ status: 'pending' }, { status: 401 });
    case 'unsupported_role':
      // The embedded mobile surface intentionally has no admin panel.
      // This result is returned before login() creates any access/refresh
      // session state; desktop web admin login remains unchanged.
      return NextResponse.json({ status: 'unsupported_role' }, { status: 403 });
    case 'invalid':
      // Unknown email or wrong password — deliberately indistinguishable
      // from `pending` at the network-timing level (see login.service.ts).
      return NextResponse.json({ status: 'invalid' }, { status: 401 });
    case 'locked':
      return NextResponse.json(
        { status: 'locked', retryAfterSeconds: result.retryAfterSeconds },
        { status: 429 },
      );
  }
}
