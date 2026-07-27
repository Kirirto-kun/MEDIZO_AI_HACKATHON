/**
 * Integration tests for the `users` tRPC router — run against the real dev
 * Postgres (same harness cases.test.ts/submissions.test.ts use: DATABASE_URL
 * loaded via `dotenv -e ../../.env.local -e ../../.env` in this package's
 * `test` script). Exercised through `appRouter.createCaller({actor})`,
 * bypassing `createContext`'s own token verification (that's
 * context.test.ts's job).
 *
 * Note `list` is asserted as adminProcedure — it matches core's `listUsers`,
 * which calls `assertAdmin` (tightened from `assertApproved` in a
 * security-hardening pass; see user.service.ts's doc comment on `listUsers`).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { prisma } from '@docjob/db';
import type { Actor, EmailMessage } from '@docjob/core';
import { appRouter } from '../root';
import { createCallerFactory } from '../trpc';
import { noopEmailSender, testPasswordResetBase, testContactInboxEmail } from '../test-helpers';

const createCaller = createCallerFactory(appRouter);

function uniqueEmail(tag: string): string {
  return `api-users-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
}

function completeRegistration(
  email: string,
  name: string,
  role: 'DOCTOR' | 'REVIEWER' = 'DOCTOR',
) {
  return {
    email,
    password: 'password123',
    name,
    fullName: name,
    region: 'astana',
    age: 30,
    specialty: 'Кардиология',
    phoneNumber: '+7 700 000 00 00',
    consentAccepted: true,
    role,
    ...(role === 'REVIEWER'
      ? { workplace: 'API Test Clinic', academicDegree: 'к.м.н.' }
      : {}),
  };
}

async function captureTRPCError(fn: () => Promise<unknown>): Promise<TRPCError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TRPCError) return e;
    throw e;
  }
  throw new Error('expected a TRPCError to be thrown');
}

describe('users router (integration, real Postgres)', () => {
  let adminUserId: string;
  let adminActor: Actor;
  let doctorUserId: string;
  let doctorActor: Actor;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: {
        email: uniqueEmail('admin'),
        passwordHash: 'unused-in-tests',
        name: 'API Users Test Admin',
        role: 'ADMIN',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    adminUserId = admin.id;
    adminActor = { id: admin.id, role: 'ADMIN', approvedAt: new Date() };

    const doctor = await prisma.user.create({
      data: {
        email: uniqueEmail('doctor'),
        passwordHash: 'unused-in-tests',
        name: 'API Users Test Doctor',
        role: 'DOCTOR',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    doctorUserId = doctor.id;
    doctorActor = { id: doctor.id, role: 'DOCTOR', approvedAt: new Date() };
  });

  afterAll(async () => {
    const ids = [...createdUserIds, adminUserId, doctorUserId];
    // RefreshToken cascades on User delete, but clean up explicitly first
    // in case a test issues one directly against these ids.
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  // ───────────────────────── register (public)

  it('register (public caller, no actor) creates an unapproved user', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const email = uniqueEmail('register');
    const result = await caller.users.register(
      completeRegistration(email, 'Newly Registered Doctor'),
    );
    createdUserIds.push(result.id);

    const row = await prisma.user.findUnique({ where: { id: result.id } });
    expect(row).not.toBeNull();
    expect(row?.email).toBe(email.toLowerCase());
    expect(row?.approvedAt).toBeNull();
  });

  it.each(['DOCTOR', 'REVIEWER'] as const)(
    'register (public caller) permits role=%s and keeps the account unapproved',
    async (role) => {
      const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
      const result = await caller.users.register(
        completeRegistration(
          uniqueEmail(`register-${role.toLowerCase()}`),
          `New ${role}`,
          role,
        ),
      );
      createdUserIds.push(result.id);

      const row = await prisma.user.findUnique({ where: { id: result.id } });
      expect(row?.role).toBe(role);
      expect(row?.approvedAt).toBeNull();
    },
  );

  it('register rejects role=ADMIN through the public tRPC procedure and creates no user', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const email = uniqueEmail('register-admin');
    const maliciousInput = {
      ...completeRegistration(email, 'Self-proclaimed Admin'),
      role: 'ADMIN',
    } as unknown as Parameters<typeof caller.users.register>[0];

    const err = await captureTRPCError(() => caller.users.register(maliciousInput));
    expect(err.code).toBe('BAD_REQUEST');
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('register rejects a malformed payload with TRPCError BAD_REQUEST (core ValidationError)', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const err = await captureTRPCError(() =>
      caller.users.register({ email: 'not-an-email', password: 'x', name: '' }),
    );
    expect(err.code).toBe('BAD_REQUEST');
  });

  // ───────────────────────── create (admin only)

  it('create lets an admin provision an already-approved doctor', async () => {
    const caller = createCaller({
      email: noopEmailSender,
      passwordResetBase: testPasswordResetBase,
      contactInboxEmail: testContactInboxEmail,
      actor: adminActor,
    });
    const email = uniqueEmail('admin-create');
    const result = await caller.users.create({
      email,
      password: 'password123',
      name: 'Admin Created Doctor',
      specialty: 'Кардиология',
      role: 'DOCTOR',
    });
    createdUserIds.push(result.id);

    const row = await prisma.user.findUnique({ where: { id: result.id } });
    expect(row?.approvedAt).not.toBeNull();
    expect(row?.consentAcceptedAt).toBeNull();
  });

  it('create rejects an approved non-admin actor', async () => {
    const caller = createCaller({
      email: noopEmailSender,
      passwordResetBase: testPasswordResetBase,
      contactInboxEmail: testContactInboxEmail,
      actor: doctorActor,
    });
    const err = await captureTRPCError(() =>
      caller.users.create({
        email: uniqueEmail('doctor-create'),
        password: 'password123',
        name: 'Forbidden Doctor',
        specialty: 'Кардиология',
        role: 'DOCTOR',
      }),
    );
    expect(err.code).toBe('FORBIDDEN');
  });

  // ───────────────────────── me

  it('me returns the actor\'s own SerializedUser', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const me = await caller.users.me();
    expect(me?.id).toBe(doctorUserId);
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('me throws TRPCError UNAUTHORIZED for no actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const err = await captureTRPCError(() => caller.users.me());
    expect(err.code).toBe('UNAUTHORIZED');
  });

  // ───────────────────────── list (adminProcedure — matches core's assertAdmin)

  it('list throws TRPCError UNAUTHORIZED for no actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const err = await captureTRPCError(() => caller.users.list());
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('list rejects with TRPCError FORBIDDEN for a non-admin (approved) actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const err = await captureTRPCError(() => caller.users.list());
    expect(err.code).toBe('FORBIDDEN');
  });

  it('list succeeds for an admin actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: adminActor });
    const list = await caller.users.list();
    expect(list.some((u) => u.id === adminUserId)).toBe(true);
  });

  // ───────────────────────── pending (adminProcedure — matches core's assertAdmin)

  it('pending rejects with TRPCError FORBIDDEN for a non-admin (approved) actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const err = await captureTRPCError(() => caller.users.pending());
    expect(err.code).toBe('FORBIDDEN');
  });

  it('pending rejects with TRPCError UNAUTHORIZED for no actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const err = await captureTRPCError(() => caller.users.pending());
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('pending as admin includes a freshly registered unapproved user', async () => {
    const publicCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const email = uniqueEmail('pending');
    const registered = await publicCaller.users.register(
      completeRegistration(email, 'Pending Approval Doctor'),
    );
    createdUserIds.push(registered.id);

    const adminCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: adminActor });
    const pending = await adminCaller.users.pending();
    expect(pending.some((u) => u.id === registered.id)).toBe(true);
  });

  // ───────────────────────── approve / reject (adminProcedure — matches core's assertAdmin)

  it('approve rejects with TRPCError FORBIDDEN for a non-admin actor', async () => {
    const publicCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const registered = await publicCaller.users.register(
      completeRegistration(uniqueEmail('approve-forbidden'), 'Approve Forbidden Target'),
    );
    createdUserIds.push(registered.id);

    const doctorCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const err = await captureTRPCError(() => doctorCaller.users.approve(registered.id));
    expect(err.code).toBe('FORBIDDEN');
  });

  it('approve as admin sets approvedAt on the target user', async () => {
    const publicCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const registered = await publicCaller.users.register(
      completeRegistration(uniqueEmail('approve-ok'), 'Approve OK Target'),
    );
    createdUserIds.push(registered.id);

    const adminCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: adminActor });
    const result = await adminCaller.users.approve(registered.id);
    expect(result).toEqual({ id: registered.id });

    const row = await prisma.user.findUnique({ where: { id: registered.id } });
    expect(row?.approvedAt).not.toBeNull();
  });

  it('reject as admin deletes an unapproved target user', async () => {
    const publicCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const registered = await publicCaller.users.register(
      completeRegistration(uniqueEmail('reject-ok'), 'Reject OK Target'),
    );

    const adminCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: adminActor });
    const result = await adminCaller.users.reject(registered.id);
    expect(result).toEqual({ id: registered.id });

    const row = await prisma.user.findUnique({ where: { id: registered.id } });
    expect(row).toBeNull();
  });

  // ───────────────────────── updateProfile (protectedProcedure — matches core's assertApproved)

  it('updateProfile lets an actor update their own profile', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const result = await caller.users.updateProfile({ id: doctorUserId, specialty: 'Cardiology' });
    expect(result).toEqual({ id: doctorUserId });

    const row = await prisma.user.findUnique({ where: { id: doctorUserId } });
    expect(row?.specialty).toBe('Cardiology');
  });

  it('updateProfile rejects a non-admin actor editing someone else with TRPCError FORBIDDEN (core check)', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor });
    const err = await captureTRPCError(() =>
      caller.users.updateProfile({ id: adminUserId, specialty: 'Should not apply' }),
    );
    expect(err.code).toBe('FORBIDDEN');
  });

  it('updateProfile throws TRPCError UNAUTHORIZED for no actor', async () => {
    const caller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const err = await captureTRPCError(() => caller.users.updateProfile({ id: doctorUserId }));
    expect(err.code).toBe('UNAUTHORIZED');
  });

  // ───────────────────────── delete (adminProcedure — matches core's assertAdmin)

  it('delete rejects with TRPCError FORBIDDEN for a non-admin actor', async () => {
    const err = await captureTRPCError(() =>
      createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: doctorActor }).users.delete(adminUserId),
    );
    expect(err.code).toBe('FORBIDDEN');
  });

  it('delete as admin removes the target user', async () => {
    const publicCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: null });
    const registered = await publicCaller.users.register(
      completeRegistration(uniqueEmail('delete-ok'), 'Delete OK Target'),
    );

    const adminCaller = createCaller({ email: noopEmailSender, passwordResetBase: testPasswordResetBase, contactInboxEmail: testContactInboxEmail, actor: adminActor });
    const result = await adminCaller.users.delete(registered.id);
    expect(result).toEqual({ id: registered.id });

    const row = await prisma.user.findUnique({ where: { id: registered.id } });
    expect(row).toBeNull();
  });

  // ───────────────────────── requestPasswordReset / resetPassword /
  // checkResetToken (publicProcedure — SP-4a Task 3)

  it('requestPasswordReset emails a reset link (via the injected sender) for a known approved user', async () => {
    const email = uniqueEmail('reset-known');
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'unused-in-tests',
        name: 'Reset Flow User',
        role: 'DOCTOR',
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);

    const send = vi.fn(async (_msg: EmailMessage) => {});
    const base = 'https://reset.docjob.test';
    const caller = createCaller({
      actor: null,
      email: { send },
      passwordResetBase: base,
      contactInboxEmail: testContactInboxEmail,
    });

    const result = await caller.users.requestPasswordReset({ email });
    expect(result).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);

    const [msg] = send.mock.calls[0];
    expect(msg.to).toBe(email.toLowerCase());
    expect(msg.text).toContain(`${base}/reset-password?token=`);
  });

  it('requestPasswordReset returns { sent: true } WITHOUT calling the sender for an unknown email (anti-enumeration)', async () => {
    const send = vi.fn(async (_msg: EmailMessage) => {});
    const caller = createCaller({
      actor: null,
      email: { send },
      passwordResetBase: testPasswordResetBase,
      contactInboxEmail: testContactInboxEmail,
    });

    const result = await caller.users.requestPasswordReset({ email: uniqueEmail('reset-unknown') });
    expect(result).toEqual({ sent: true });
    expect(send).not.toHaveBeenCalled();
  });

  it(
    'requestPasswordReset throttles per-IP after 5 requests in the window: the 6th is still ' +
      '{ sent: true } but does NOT call the sender (SP-5 T4, distinct from core\'s own ' +
      'per-user resend cooldown — each user below is a first-ever, never-throttled-by-core request)',
    async () => {
      const send = vi.fn(async (_msg: EmailMessage) => {});
      const ip = '203.0.113.77';
      const caller = createCaller({
        actor: null,
        email: { send },
        passwordResetBase: testPasswordResetBase,
        contactInboxEmail: testContactInboxEmail,
        ip,
      });

      // 5 distinct, never-before-requested users from the SAME IP — each is
      // core's first-ever token for that user, so core's own resend cooldown
      // never engages; only the router-level per-IP window is in play.
      for (let i = 0; i < 5; i++) {
        const email = uniqueEmail(`reset-ip-throttle-${i}`);
        const user = await prisma.user.create({
          data: {
            email,
            passwordHash: 'unused-in-tests',
            name: 'Reset IP Throttle User',
            role: 'DOCTOR',
            approvedAt: new Date(),
          },
          select: { id: true },
        });
        createdUserIds.push(user.id);

        const result = await caller.users.requestPasswordReset({ email });
        expect(result).toEqual({ sent: true });
      }
      expect(send).toHaveBeenCalledTimes(5);

      // A 6th, also never-before-requested user from the SAME IP within the
      // window is throttled — still { sent: true }, and (unlike the first
      // 5) no email is sent. Proves this is the router-level IP throttle,
      // not core's cooldown: this user has no prior token at all, so core
      // itself would have allowed it.
      const sixthEmail = uniqueEmail('reset-ip-throttle-6th');
      const sixthUser = await prisma.user.create({
        data: {
          email: sixthEmail,
          passwordHash: 'unused-in-tests',
          name: 'Reset IP Throttle 6th User',
          role: 'DOCTOR',
          approvedAt: new Date(),
        },
        select: { id: true },
      });
      createdUserIds.push(sixthUser.id);

      const throttled = await caller.users.requestPasswordReset({ email: sixthEmail });
      expect(throttled).toEqual({ sent: true });
      expect(send).toHaveBeenCalledTimes(5); // unchanged — the 6th did not send
    },
  );

  it('checkResetToken returns { valid: false } for a garbage token', async () => {
    const caller = createCaller({
      email: noopEmailSender,
      passwordResetBase: testPasswordResetBase,
      contactInboxEmail: testContactInboxEmail,
      actor: null,
    });

    const result = await caller.users.checkResetToken('garbage-not-a-real-token');
    expect(result).toEqual({ valid: false });
  });
});
