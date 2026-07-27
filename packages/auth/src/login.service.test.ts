/**
 * Integration tests for login.service — run against the real dev Postgres
 * (same harness Task 2/3 established for @docjob/auth: DATABASE_URL loaded
 * via `dotenv -e ../../.env.local -e ../../.env` in the package's `test`
 * script).
 *
 * Each test creates its own throwaway User (+ whatever RefreshToken rows a
 * successful `login` creates) and cleans them up in `afterEach`, rather than
 * relying on transaction rollback. Every test passes its own dedicated
 * `AttemptLimiter` instance (except where the default is intentionally
 * exercised) so attempt counts from one test can't bleed into another.
 */
import { describe, it, expect, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma, type Role } from '@docjob/db';
import { hashPassword } from './passwords';
import { verifyAccessToken, type SigningKey } from './tokens';
import { login } from './login.service';
import { createInMemoryLimiter } from './rate-limit';

const testKey: SigningKey = { kid: 'login-test-kid', secret: 'login-test-secret-at-least-32-bytes!!' };

describe('login (integration, real Postgres)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    if (createdUserIds.length) {
      // RefreshToken rows cascade-delete with the user (onDelete: Cascade).
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  function uniqueEmail(tag: string): string {
    return `auth-login-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  }

  async function makeUser(opts: { email: string; passwordHash: string; approvedAt: Date | null; role?: Role }) {
    const user = await prisma.user.create({
      data: {
        email: opts.email,
        passwordHash: opts.passwordHash,
        name: 'Login Test User',
        role: opts.role ?? 'DOCTOR',
        approvedAt: opts.approvedAt,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  it('valid credentials + approved user -> ok, with a verifying access token and matching sub/role', async () => {
    const email = uniqueEmail('ok');
    const passwordHash = await hashPassword('correct horse battery staple');
    const user = await makeUser({ email, passwordHash, approvedAt: new Date(), role: 'DOCTOR' });

    const result = await login(
      { email, password: 'correct horse battery staple', ip: '10.0.0.1' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.user).toEqual({ id: user.id, role: 'DOCTOR', approvedAt: user.approvedAt });
    expect(typeof result.access).toBe('string');
    expect(typeof result.refresh).toBe('string');
    expect(result.refreshExpiresAt).toBeInstanceOf(Date);

    const claims = await verifyAccessToken(result.access, [testKey]);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe(user.id);
    expect(claims!.role).toBe('DOCTOR');
  });

  it('valid credentials + unapproved user -> pending (revealed only after the password verifies)', async () => {
    const email = uniqueEmail('pending');
    const passwordHash = await hashPassword('correct horse battery staple');
    await makeUser({ email, passwordHash, approvedAt: null });

    const result = await login(
      { email, password: 'correct horse battery staple', ip: '10.0.0.2' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result).toEqual({ status: 'pending' });
  });

  it('rejects a valid ADMIN login when the client allows only DOCTOR/REVIEWER, before creating refresh state', async () => {
    const email = uniqueEmail('mobile-admin');
    const passwordHash = await hashPassword('correct horse battery staple');
    const user = await makeUser({ email, passwordHash, approvedAt: new Date(), role: 'ADMIN' });

    const result = await login(
      {
        email,
        password: 'correct horse battery staple',
        ip: '10.0.0.21',
        allowedRoles: ['DOCTOR', 'REVIEWER'],
      },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result).toEqual({ status: 'unsupported_role' });
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('keeps an approved ADMIN login unchanged when the client has no role restriction', async () => {
    const email = uniqueEmail('desktop-admin');
    const passwordHash = await hashPassword('correct horse battery staple');
    const user = await makeUser({ email, passwordHash, approvedAt: new Date(), role: 'ADMIN' });

    const result = await login(
      { email, password: 'correct horse battery staple', ip: '10.0.0.22' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.user.role).toBe('ADMIN');
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('wrong password -> invalid', async () => {
    const email = uniqueEmail('wrongpw');
    const passwordHash = await hashPassword('correct horse battery staple');
    await makeUser({ email, passwordHash, approvedAt: new Date() });

    const result = await login(
      { email, password: 'totally wrong password', ip: '10.0.0.3' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result).toEqual({ status: 'invalid' });
  });

  it('unknown email -> invalid', async () => {
    const result = await login(
      { email: uniqueEmail('doesnotexist'), password: 'whatever', ip: '10.0.0.4' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result).toEqual({ status: 'invalid' });
  });

  it('legacy bcrypt user logging in with the right password -> ok, and the stored hash is rehashed to argon2id', async () => {
    const email = uniqueEmail('bcrypt');
    const legacyHash = bcrypt.hashSync('legacy secret', 10);
    const user = await makeUser({ email, passwordHash: legacyHash, approvedAt: new Date() });

    const result = await login(
      { email, password: 'legacy secret', ip: '10.0.0.5' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result.status).toBe('ok');

    const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reread.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(reread.passwordHash).not.toBe(legacyHash);
  });

  it('a legacy bcrypt user still gets rehashed even while pending (rehash happens before the approval gate)', async () => {
    const email = uniqueEmail('bcrypt-pending');
    const legacyHash = bcrypt.hashSync('legacy secret', 10);
    const user = await makeUser({ email, passwordHash: legacyHash, approvedAt: null });

    const result = await login(
      { email, password: 'legacy secret', ip: '10.0.0.7' },
      testKey,
      createInMemoryLimiter(),
    );

    expect(result).toEqual({ status: 'pending' });

    const reread = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(reread.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('locks out after maxAttempts failures for the ip/email key, short-circuiting before the DB/password path runs', async () => {
    const email = uniqueEmail('lockout');
    const passwordHash = await hashPassword('correct horse battery staple');
    await makeUser({ email, passwordHash, approvedAt: new Date() });
    const limiter = createInMemoryLimiter({ maxAttempts: 3, windowSeconds: 60, lockSeconds: 60 });
    const ip = '10.0.0.6';

    for (let i = 0; i < 3; i++) {
      const result = await login({ email, password: 'wrong', ip }, testKey, limiter);
      expect(result).toEqual({ status: 'invalid' });
    }

    // The 4th attempt must be locked BEFORE the DB/password path runs at
    // all — prove it by presenting the CORRECT password: if the lock check
    // didn't short-circuit, this would return `ok` instead of `locked`.
    const locked = await login(
      { email, password: 'correct horse battery staple', ip },
      testKey,
      limiter,
    );
    expect(locked.status).toBe('locked');
    if (locked.status !== 'locked') throw new Error('expected locked');
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('locking one email/ip pair does not lock an unrelated email/ip pair on a shared limiter', async () => {
    const lockedEmail = uniqueEmail('lockout-a');
    const okEmail = uniqueEmail('lockout-b');
    const passwordHash = await hashPassword('correct horse battery staple');
    await makeUser({ email: lockedEmail, passwordHash, approvedAt: new Date() });
    const okUser = await makeUser({ email: okEmail, passwordHash, approvedAt: new Date() });
    const limiter = createInMemoryLimiter({ maxAttempts: 2, windowSeconds: 60, lockSeconds: 60 });

    for (let i = 0; i < 2; i++) {
      await login({ email: lockedEmail, password: 'wrong', ip: '10.0.0.8' }, testKey, limiter);
    }
    const stillLocked = await login(
      { email: lockedEmail, password: 'correct horse battery staple', ip: '10.0.0.8' },
      testKey,
      limiter,
    );
    expect(stillLocked.status).toBe('locked');

    const unaffected = await login(
      { email: okEmail, password: 'correct horse battery staple', ip: '10.0.0.9' },
      testKey,
      limiter,
    );
    expect(unaffected.status).toBe('ok');
    if (unaffected.status !== 'ok') throw new Error('expected ok');
    expect(unaffected.user.id).toBe(okUser.id);
  });
});
