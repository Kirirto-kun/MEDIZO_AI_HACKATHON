import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// Edge-safe subpath: `verifyAccessToken` (jose-only) — NEVER import the
// `@docjob/auth` barrel here. That barrel also re-exports `login.service.ts`
// / `refresh.service.ts`, which pull in Prisma and the native
// `@node-rs/argon2` binding, neither of which can be bundled for the Edge
// runtime this middleware compiles to. See `packages/auth/src/tokens.ts`'s
// file-header comment.
import { verifyAccessToken, type AccessClaims } from '@docjob/auth/tokens';
import { isDocJobMobileUserAgent } from '@docjob/types';
import { clearAuthCookies, getAccessToken } from '@/lib/auth-cookies';
import { verificationKeys } from '@/lib/auth-keys';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from '@/i18n/config';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/landing',
  '/download',
  '/news',
  '/robots.txt',
  '/sitemap.xml',
  '/forgot-password',
  '/reset-password',
];
const PUBLIC_ASSET_FILE = /\.(?:avif|gif|jpg|jpeg|png|svg|webp)$/i;

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (!pathname.startsWith('/api/') && PUBLIC_ASSET_FILE.test(pathname)) return true;
  if (pathname.startsWith('/legal/')) return true;
  if (pathname.startsWith('/planet/')) return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname.startsWith('/api/images/')) return true;
  if (pathname.startsWith('/api/i18n/')) return true;
  // Polled unauthenticated by Docker's healthcheck, Nginx, and uptime
  // monitors (SP-5 T3, see apps/web/src/app/api/health/route.ts) — must
  // never redirect to /login or 401.
  if (pathname === '/api/health') return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  return false;
}

function ensureLocaleCookie(req: NextRequest, res: NextResponse): NextResponse {
  const existing = req.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(existing)) return res;

  const accept = req.headers.get('accept-language') ?? '';
  const preferred = accept.toLowerCase().includes('kk') ? 'kk' : DEFAULT_LOCALE;
  res.cookies.set(LOCALE_COOKIE, preferred, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

/**
 * Edge-only authentication check: verifies the access-token cookie's
 * signature/expiry (jose, no DB round trip). Deliberately does NOT consult
 * the refresh cookie or attempt a rotation here — if the access token is
 * missing/expired, this always resolves to "unauthenticated" even when a
 * live refresh token exists. Client-side navigations recover from that via
 * `@/lib/auth-client.ts`'s single-flight refresh-then-retry interceptor;
 * doing the refresh (Prisma + a fresh JWT sign) inside middleware itself
 * would require Node APIs this Edge runtime can't run.
 */
async function authenticatedClaims(req: NextRequest): Promise<AccessClaims | null> {
  const token = getAccessToken(req.cookies);
  if (!token) return null;
  return verifyAccessToken(token, verificationKeys());
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const claims = await authenticatedClaims(req);
  const authenticated = claims !== null;

  // The embedded Android surface deliberately exposes only DOCTOR and
  // REVIEWER UI. Reject a pre-existing ADMIN access cookie as a defence in
  // depth (for example, a cookie created before this role gate shipped),
  // clear both auth cookies, and explain why the user was signed out.
  if (
    claims?.role === 'ADMIN' &&
    isDocJobMobileUserAgent(req.headers.get('user-agent'))
  ) {
    const alreadyOnReasonedLogin =
      pathname === '/login' && req.nextUrl.searchParams.get('mobileAdmin') === '1';
    const res = alreadyOnReasonedLogin
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/login?mobileAdmin=1', req.url));
    clearAuthCookies(res);
    return ensureLocaleCookie(req, res);
  }

  // Unauthenticated visitors hitting the bare domain see the landing page,
  // not the login form. The installed mobile shell is an application rather
  // than a marketing surface, so it opens login and can silently restore a
  // still-valid refresh cookie when the short-lived access cookie expired.
  // Authenticated users continue to the dashboard.
  if (pathname === '/' && !authenticated) {
    if (isDocJobMobileUserAgent(req.headers.get('user-agent'))) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('callbackUrl', '/');
      return ensureLocaleCookie(req, NextResponse.redirect(loginUrl));
    }
    return ensureLocaleCookie(req, NextResponse.redirect(new URL('/landing', req.url)));
  }

  if (isPublic(pathname)) {
    return ensureLocaleCookie(req, NextResponse.next());
  }

  // `/api/trpc/*` (SP-1d, see packages/api) is deliberately NOT added to
  // `isPublic` above: every procedure that needs a caller still requires
  // one. But unauthenticated tRPC calls must reach the tRPC handler itself
  // so it replies with its own typed `UNAUTHORIZED` error — the JSON shape
  // an `@trpc/client` caller parses — rather than this middleware's generic
  // `{error:'Unauthorized'}` 401 (fine for the REST-style routes below, but
  // not what a tRPC client expects) or, for a page navigation, a redirect to
  // `/login`. `protectedProcedure`/`reviewerProcedure`/`adminProcedure` (see
  // packages/api/src/trpc.ts) do the actual gating per procedure from
  // `ctx.actor`, which `createContext` resolves independently of this
  // middleware's own (Edge-only, access-cookie-only) `isAuthenticated`
  // check — so this bypass only skips the middleware-level short-circuit,
  // never auth itself.
  if (pathname.startsWith('/api/trpc/')) {
    return ensureLocaleCookie(req, NextResponse.next());
  }

  // `/api/attachments/*` (SP-4a Task 4, see route.ts) is deliberately NOT
  // gated by this middleware's cookie-only `isAuthenticated` check either,
  // for the same reason `/api/trpc/*` above isn't: this Edge-only check can
  // only see the access-token *cookie* (`getAccessToken(req.cookies)`), not
  // an `Authorization: Bearer` header, so a mobile client sending Bearer and
  // no cookie would get a blanket 401 right here — before its perfectly
  // valid token ever reached the route handler. The route handler itself
  // (`getUserFromRequest`, `@/lib/session`) does the real Bearer-then-cookie
  // auth check and returns its own 401 when neither is present/valid, so
  // this bypass only skips the middleware-level short-circuit, never auth.
  if (pathname.startsWith('/api/attachments/')) {
    return ensureLocaleCookie(req, NextResponse.next());
  }

  if (!authenticated) {
    // API callers get a 401 they can act on programmatically; page
    // navigations get redirected to the login form with a callbackUrl.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
    return ensureLocaleCookie(req, NextResponse.redirect(loginUrl));
  }
  return ensureLocaleCookie(req, NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
