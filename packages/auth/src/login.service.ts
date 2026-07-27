import { prisma } from '@docjob/db';
import type { Role } from '@docjob/db';
import { hashPassword, verifyPassword, needsRehash } from './passwords';
import { signAccessToken, type SigningKey } from './tokens';
import { issueRefreshFamily } from './refresh.service';
import type { AttemptLimiter } from './rate-limit';
import { getLoginLimiter } from './rate-limit-redis';

export type LoginResult =
  | {
      status: 'ok';
      access: string;
      refresh: string;
      refreshExpiresAt: Date;
      user: { id: string; role: Role; approvedAt: Date | null };
    }
  | { status: 'pending' } // credentials valid but not admin-approved
  | { status: 'unsupported_role' } // credentials valid, but this client surface excludes the role
  | { status: 'invalid' } // wrong email/password (or unknown email)
  | { status: 'locked'; retryAfterSeconds: number };

/**
 * Default limiter shared across calls that don't inject their own. SP-5 T4:
 * `getLoginLimiter()` selects a Redis-backed `AttemptLimiter`
 * (`rate-limit-redis.ts`) when `REDIS_URL` is set, else the original
 * module-level `Map`-backed one (`rate-limit.ts`) — correct for a single
 * process, which remains the default when Redis isn't configured.
 */
const defaultLimiter: AttemptLimiter = getLoginLimiter();

/**
 * Lazily-computed argon2id hash of a fixed dummy password. When the email
 * doesn't match any user we still run a verify against this hash before
 * returning `invalid`, so the response takes roughly the same wall-clock
 * time as the "user exists, wrong password" path — otherwise timing alone
 * would let an attacker enumerate registered emails.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('login-dummy-password-timing-equalizer');
  }
  return dummyHashPromise;
}

/**
 * The single authoritative login path. Folds together what used to be two
 * separate, security-flawed checks: NextAuth's `authorize()` (bcrypt
 * compare, no throttle) and the PUBLIC `core.users.checkLoginIssue` oracle
 * (revealed "pending vs invalid" from an unauthenticated caller without a
 * successful password check gating it — see `apps/web/src/lib/auth.ts` and
 * `packages/core/src/users/user.service.ts::checkLoginIssue`, both of which
 * this replaces once the web app cuts over).
 *
 * Order of operations, precisely (each step short-circuits the rest):
 *  1. Rate-limit check for BOTH `ip:<ip>` and `email:<email>` keys, before
 *     touching the DB or running any password hash — a locked-out caller
 *     never gets to burn a Postgres round trip or an argon2 verify.
 *  2. Look up the user by lower-cased email. Unknown email → record a
 *     failure on both keys, run a dummy verify for timing, return `invalid`.
 *  3. `verifyPassword` against the stored hash (argon2id or legacy bcrypt).
 *     Wrong password → record a failure on both keys, return `invalid`.
 *  4. Password OK → record a success on both keys (clears their windows).
 *     If the stored hash is legacy bcrypt, transparently rehash to argon2id
 *     and persist it — this runs regardless of the approval gate below, so
 *     even a not-yet-approved user's password migrates off bcrypt on first
 *     correct login.
 *  5. `approvedAt` gate: unapproved → `pending`. This is the oracle fix —
 *     "pending" is only ever revealed AFTER the password has verified, so a
 *     caller who doesn't know the password can't distinguish "no such
 *     account" from "account pending approval" from "wrong password" — all
 *     three look identical (`invalid`) until the real password is supplied.
 *  6. Optional client-surface role gate: a valid but unsupported role
 *     returns `unsupported_role` before any session state is created.
 *  7. Approved + allowed → mint a short-lived access JWT + a fresh
 *     refresh-token family and return `ok`.
 */
export async function login(
  input: {
    email: string;
    password: string;
    ip: string;
    deviceLabel?: string;
    allowedRoles?: readonly Role[];
  },
  key: SigningKey,
  limiter: AttemptLimiter = defaultLimiter,
): Promise<LoginResult> {
  const email = input.email.toLowerCase();
  const ipKey = `ip:${input.ip}`;
  const emailKey = `email:${email}`;

  const [ipCheck, emailCheck] = await Promise.all([limiter.check(ipKey), limiter.check(emailKey)]);
  if (!ipCheck.allowed || !emailCheck.allowed) {
    return {
      status: 'locked',
      retryAfterSeconds: Math.max(ipCheck.retryAfterSeconds, emailCheck.retryAfterSeconds),
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword(await dummyHash(), input.password);
    await Promise.all([limiter.record(ipKey, false), limiter.record(emailKey, false)]);
    return { status: 'invalid' };
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    await Promise.all([limiter.record(ipKey, false), limiter.record(emailKey, false)]);
    return { status: 'invalid' };
  }

  await Promise.all([limiter.record(ipKey, true), limiter.record(emailKey, true)]);

  if (needsRehash(user.passwordHash)) {
    const rehashed = await hashPassword(input.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: rehashed } });
  }

  if (!user.approvedAt) {
    return { status: 'pending' };
  }

  // Client-surface role restrictions must run before either token is minted.
  // In particular, the embedded mobile app intentionally supports only the
  // DOCTOR and REVIEWER experiences; ADMIN remains web-desktop-only.
  if (input.allowedRoles && !input.allowedRoles.includes(user.role)) {
    return { status: 'unsupported_role' };
  }

  const access = await signAccessToken(
    { sub: user.id, role: user.role, approvedAt: user.approvedAt.toISOString() },
    key,
  );
  const { raw, expiresAt } = await issueRefreshFamily(user.id, input.deviceLabel);

  return {
    status: 'ok',
    access,
    refresh: raw,
    refreshExpiresAt: expiresAt,
    user: { id: user.id, role: user.role, approvedAt: user.approvedAt },
  };
}
