import { z } from 'zod';
import { hashPassword } from '@docjob/auth';
import { prisma, Prisma } from '@docjob/db';
import { assertAdmin, assertApproved, type Actor } from '../shared/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../shared/errors';
import { serializeUser, type SerializedUser } from './user.mapper';
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  isResetTokenUsable,
  isWithinResendCooldown,
} from './password-reset-tokens';

// ───────────────────────── Validation schemas (moved verbatim from actions.ts)

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  fullName: z.string().optional(),
  region: z.string().optional(),
  age: z.coerce.number().int().min(16).max(100).optional(),
  specialty: z.string().optional(),
  phoneNumber: z
    .string()
    .min(7)
    .regex(/^[\d +\-()]+$/)
    .optional(),
  workplace: z.string().optional(),
  academicDegree: z.string().optional(),
  consentAccepted: z.boolean().optional(),
  // This schema is the security boundary for public self-registration.
  // ADMIN accounts must be provisioned out-of-band, never selected by an
  // anonymous caller. Doctors and reviewers are both intentional public
  // registration paths and remain available here.
  role: z.enum(['DOCTOR', 'REVIEWER']).optional(),
}).superRefine((data, ctx) => {
  const requireText = (value: string | undefined, path: string, minimum = 1) => {
    if (!value || value.trim().length < minimum) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: 'Required' });
    }
  };

  requireText(data.fullName, 'fullName', 2);
  requireText(data.region, 'region');
  requireText(data.specialty, 'specialty');
  requireText(data.phoneNumber, 'phoneNumber', 7);
  if (data.age === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['age'], message: 'Required' });
  }
  if (data.consentAccepted !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['consentAccepted'], message: 'Required' });
  }
  if (data.role === 'REVIEWER') {
    requireText(data.workplace, 'workplace', 2);
    requireText(data.academicDegree, 'academicDegree', 2);
  }
});
export type RegisterUserInput = z.infer<typeof registerSchema>;

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  fullName: z.string().optional(),
  region: z.string().optional(),
  age: z.coerce.number().int().min(16).max(100).optional(),
  specialty: z.string().min(1),
  phoneNumber: z
    .string()
    .min(7)
    .regex(/^[\d +\-()]+$/)
    .optional(),
  workplace: z.string().optional(),
  academicDegree: z.string().optional(),
  role: z.enum(['DOCTOR', 'REVIEWER']),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

const updateUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  fullName: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  age: z.number().int().positive().optional().nullable(),
  specialty: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  workplace: z.string().optional().nullable(),
  academicDegree: z.string().optional().nullable(),
  profilePhotoUrl: z.string().optional().nullable(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

// ───────────────────────── Registration / profile

/**
 * Public self-registration. Accounts are always unapproved and may only be
 * created as DOCTOR (the default) or REVIEWER. ADMIN is deliberately absent
 * from the input schema so every caller of this core function, including the
 * public tRPC procedure, shares the same privilege-escalation guard.
 */
export async function registerUser(input: RegisterUserInput): Promise<{ id: string }> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Проверьте правильность заполнения формы.');
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) throw new ConflictError('Пользователь с такой почтой уже существует.');

  const passwordHash = await hashPassword(data.password);

  const created = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      fullName: data.fullName,
      region: data.region,
      age: data.age,
      specialty: data.specialty,
      phoneNumber: data.phoneNumber,
      workplace: data.workplace,
      academicDegree: data.academicDegree,
      role: data.role ?? 'DOCTOR',
      consentAcceptedAt: data.consentAccepted ? new Date() : null,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Administrative account provisioning is deliberately separate from public
 * self-registration. It does not fabricate a consent acceptance on the
 * user's behalf and creates the account already approved, matching the
 * desktop "Добавить врача" workflow.
 */
export async function createUser(
  actor: Actor | null,
  input: CreateUserInput,
): Promise<{ id: string }> {
  assertAdmin(actor, 'Только администратор может создавать пользователей.');
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Проверьте правильность заполнения формы.');
  }
  const data = parsed.data;
  const email = data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('Пользователь с такой почтой уже существует.');
  }

  const passwordHash = await hashPassword(data.password);
  const created = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: data.name,
      fullName: data.fullName,
      region: data.region,
      age: data.age,
      specialty: data.specialty,
      phoneNumber: data.phoneNumber,
      workplace: data.workplace,
      academicDegree: data.academicDegree,
      role: data.role,
      approvedAt: new Date(),
      consentAcceptedAt: null,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Update a user's own profile fields, or (if the actor is an admin) another
 * user's. Preserves the original `requireUserSafe()` gate exactly via
 * `assertApproved` — see case.service.ts's `listCases` comment for why that
 * substitution is behavior-preserving (login already requires
 * `approvedAt` to be set).
 */
export async function updateUser(actor: Actor | null, input: UpdateUserInput): Promise<{ id: string }> {
  const current = assertApproved(actor, 'Требуется авторизация.');
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Некорректные данные пользователя.');

  if (current.id !== parsed.data.id && current.role !== 'ADMIN') {
    throw new ForbiddenError('Недостаточно прав.');
  }

  const { id, ...rest } = parsed.data;
  const data: Prisma.UserUpdateInput = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) (data as Record<string, unknown>)[k] = v;
  }
  await prisma.user.update({ where: { id }, data });
  return { id };
}

/**
 * List all users, newest-last. Admin only — this returns every user's full
 * profile (including email), so an open `assertApproved` gate let any
 * approved doctor/reviewer enumerate the entire user directory. Tightened
 * as a security-hardening fix; see `apps/web/src/hooks/use-user-store.tsx`
 * for the corresponding client-side refactor (non-admins no longer fetch
 * this list).
 */
export async function listUsers(actor: Actor | null): Promise<SerializedUser[]> {
  assertAdmin(actor, 'Список пользователей доступен только администратору.');
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return users.map(serializeUser);
}

/**
 * Fetch a user by id and serialize it, or `null` if not found. No auth
 * check here — callers (e.g. the `getSessionUser` web wrapper, which reads
 * the session itself) are responsible for resolving/authenticating the id
 * first. This is a plain lookup, not exposed as its own server action.
 */
export async function getUserById(id: string): Promise<SerializedUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? serializeUser(user) : null;
}

// ───────────────────────── Registration approval (admin)

export async function listPendingUsers(actor: Actor | null): Promise<SerializedUser[]> {
  assertAdmin(actor, 'Только администратор может видеть заявки.');
  const users = await prisma.user.findMany({
    where: { approvedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return users.map(serializeUser);
}

export async function approveUser(actor: Actor | null, userId: string): Promise<{ id: string }> {
  assertAdmin(actor, 'Только администратор может одобрять заявки.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Пользователь не найден.');
  if (user.approvedAt) throw new ConflictError('Пользователь уже одобрен.');
  await prisma.user.update({ where: { id: userId }, data: { approvedAt: new Date() } });
  return { id: userId };
}

export async function rejectUser(actor: Actor | null, userId: string): Promise<{ id: string }> {
  assertAdmin(actor, 'Только администратор может отклонять заявки.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Пользователь не найден.');
  if (user.approvedAt) throw new ConflictError('Нельзя отклонить уже одобренного пользователя.');
  await prisma.user.delete({ where: { id: userId } });
  return { id: userId };
}

/**
 * Permanently delete a user — revokes their access to the platform entirely.
 * Cascades remove their authored cases, saved cases, reviews and
 * submissions (see onDelete: Cascade in the schema). Admin-only; an admin
 * cannot delete their own account.
 */
export async function deleteUser(actor: Actor | null, userId: string): Promise<{ id: string }> {
  const admin = assertAdmin(actor, 'Только администратор может удалять пользователей.');
  if (admin.id === userId) {
    throw new ForbiddenError('Нельзя удалить собственную учётную запись администратора.');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Пользователь не найден.');
  await prisma.user.delete({ where: { id: userId } });
  return { id: userId };
}

// ───────────────────────── Password reset
//
// SP-1c folded the login-diagnostics oracle (`checkLoginIssue`) into
// `@docjob/auth`'s `login()` — see `packages/auth/src/login.service.ts`'s
// doc comment for why (it was a pre-auth, unauthenticated oracle that leaked
// "pending vs invalid" without gating on a successful password check).
// Password hashing here now goes through `@docjob/auth`'s `hashPassword`
// (argon2id) rather than bcrypt directly. Email sending is a
// transport/infra concern (uses the `resend` package + env vars) and stays
// in the web wrapper; these functions only do the DB/token bookkeeping and
// hand back what the wrapper needs to build and send the email.

export type PasswordResetIssued = { userId: string; to: string; rawToken: string };

/**
 * Issue a password-reset token if (and only if) the email belongs to an
 * existing, admin-approved user and a resend isn't currently throttled.
 * Returns `null` in every other case (malformed email, unknown email,
 * unapproved account, throttled) — the caller (web wrapper) responds the
 * same way regardless, preserving the original anti-enumeration behavior.
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetIssued | null> {
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return null;

  const normalized = parsed.data.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !user.approvedAt) return null;

  const now = new Date();
  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const throttled =
    !!recent && recent.expiresAt > now && isWithinResendCooldown(recent.createdAt, now);
  if (throttled) return null;

  const rawToken = generateResetToken();
  // Invalidate any outstanding tokens and issue a fresh one atomically, so
  // concurrent requests can't leave two simultaneously-valid tokens.
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: resetTokenExpiry(now),
      },
    }),
  ]);

  return { userId: user.id, to: normalized, rawToken };
}

/** Lightweight check so the reset page can show "link expired" before input. */
export async function checkResetToken(token: string): Promise<{ valid: boolean }> {
  if (!token) return { valid: false };
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });
  if (!record) return { valid: false };
  return { valid: isResetTokenUsable(record, new Date()) };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ id: string }> {
  const parsed = resetPasswordSchema.safeParse({ token, newPassword });
  if (!parsed.success) throw new ValidationError('Пароль должен быть не короче 6 символов.');

  const now = new Date();
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(parsed.data.token) },
  });
  if (!record || !isResetTokenUsable(record, now)) {
    throw new ValidationError('Ссылка устарела или недействительна. Запросите восстановление заново.');
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    }),
  ]);

  return { id: record.userId };
}
