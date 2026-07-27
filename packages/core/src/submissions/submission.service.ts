import { z } from 'zod';
import { prisma, Prisma } from '@docjob/db';
import { assertAdmin, assertApproved, type Actor } from '../shared/actor';
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors';
import {
  serializeSubmission,
  type SerializedCaseSubmission,
  type SerializedSubmissionMessage,
  type SerializedSubmissionAttachment,
} from './submission.mapper';

// ───────────────────────── Validation schemas (moved verbatim from actions.ts)

const createSubmissionSchema = z.object({
  title: z.string().min(3, 'Название слишком короткое.').max(200),
  description: z.string().min(10, 'Опишите кейс подробнее.').max(20000),
  authors: z.array(z.string().min(1)).default([]),
  subgroup: z.string().optional().nullable(),
  attachmentIds: z.array(z.string()).optional(),
});
export type CreateCaseSubmissionInput = z.infer<typeof createSubmissionSchema>;

const sendSubmissionMessageSchema = z.object({
  submissionId: z.string().min(1),
  body: z.string().min(1, 'Сообщение не может быть пустым.').max(5000),
  attachmentIds: z.array(z.string()).optional(),
});
export type SendCaseSubmissionMessageInput = z.infer<typeof sendSubmissionMessageSchema>;

const SUBMISSION_STATUSES = ['new', 'in_review', 'accepted', 'rejected', 'done'] as const;
export type CaseSubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

const submissionInclude = {
  author: true,
  messages: { include: { sender: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.CaseSubmissionInclude;

/**
 * Resolve a set of pre-uploaded `CaseAttachment` ids into the small
 * `SerializedSubmissionAttachment` shape stored on `CaseSubmissionMessage.attachments`
 * (a JSON blob, not a live relation). Non-admin callers may resolve only
 * their own still-unclaimed uploads; admins may use any unclaimed upload.
 */
async function attachmentsForIds(
  tx: Prisma.TransactionClient,
  ids: string[],
  actor: Actor,
): Promise<SerializedSubmissionAttachment[]> {
  if (!ids.length) return [];

  const uniqueIds = [...new Set(ids)];
  const rows = await tx.caseAttachment.findMany({
    where: {
      id: { in: uniqueIds },
      caseId: null,
      submissionMessageId: null,
      ...(actor.role === 'ADMIN' ? {} : { uploaderId: actor.id }),
    },
  });
  if (rows.length !== uniqueIds.length) {
    throw new ValidationError('Один или несколько файлов недоступны.');
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return uniqueIds.map((id) => {
    const attachment = rowsById.get(id);
    if (!attachment) {
      throw new ValidationError('Один или несколько файлов недоступны.');
    }
    return {
      attachmentId: attachment.id,
      filename: attachment.filename,
      originalName: attachment.originalName,
      url: `/api/attachments/${attachment.filename}`,
      mimeType: attachment.mimeType,
      size: attachment.size,
    };
  });
}

async function claimAttachments(
  tx: Prisma.TransactionClient,
  ids: string[],
  actor: Actor,
  submissionMessageId: string,
): Promise<void> {
  if (!ids.length) return;
  const uniqueIds = [...new Set(ids)];
  const claimed = await tx.caseAttachment.updateMany({
    where: {
      id: { in: uniqueIds },
      caseId: null,
      submissionMessageId: null,
      ...(actor.role === 'ADMIN' ? {} : { uploaderId: actor.id }),
    },
    data: { submissionMessageId },
  });
  if (claimed.count !== uniqueIds.length) {
    // A concurrent request claimed at least one ID after the read. Throwing
    // inside the transaction rolls back the message and every partial claim.
    throw new ValidationError('Один или несколько файлов уже используются.');
  }
}

// ───────────────────────── Writes

/**
 * Create a new case-submission (a doctor/reviewer proposing a case for the
 * catalog) plus its opening message (the description itself). Any approved
 * user may submit — preserves the original `requireUser()` check, now
 * expressed as `assertApproved` (no role restriction).
 */
export async function createCaseSubmission(
  actor: Actor | null,
  input: CreateCaseSubmissionInput,
): Promise<SerializedCaseSubmission> {
  const user = assertApproved(actor, 'Требуется авторизация.');

  const parsed = createSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Некорректные данные предложения.');
  }
  const authors = parsed.data.authors.map((a) => a.trim()).filter(Boolean);
  const attachmentIds = parsed.data.attachmentIds ?? [];

  const created = await prisma.$transaction(async (tx) => {
    const attachments = await attachmentsForIds(tx, attachmentIds, user);
    const submission = await tx.caseSubmission.create({
      data: {
        authorUserId: user.id,
        title: parsed.data.title.trim(),
        description: parsed.data.description.trim(),
        authors,
        subgroup: parsed.data.subgroup ?? null,
      },
    });

    const openingMessage = await tx.caseSubmissionMessage.create({
      data: {
        submissionId: submission.id,
        senderId: user.id,
        body: parsed.data.description.trim(),
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await claimAttachments(tx, attachmentIds, user, openingMessage.id);

    return { submissionId: submission.id };
  });

  // Re-fetch through the same author-or-admin gate `getCaseSubmissionById`
  // enforces, matching the original action which called `getCaseSubmissionById`
  // at the end (the creating user is always the author, so this always succeeds).
  return getCaseSubmissionById(actor, created.submissionId);
}

/**
 * Append a message to an existing submission's discussion thread. The
 * submission's own author, or an admin, may post — anyone else is
 * forbidden. Preserves the original Russian error text.
 */
export async function sendCaseSubmissionMessage(
  actor: Actor | null,
  input: SendCaseSubmissionMessageInput,
): Promise<SerializedSubmissionMessage> {
  const user = assertApproved(actor, 'Требуется авторизация.');
  const parsed = sendSubmissionMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Некорректные данные сообщения.');
  }

  const attachmentIds = parsed.data.attachmentIds ?? [];
  const { created, attachments } = await prisma.$transaction(async (tx) => {
    const submission = await tx.caseSubmission.findUnique({
      where: { id: parsed.data.submissionId },
      select: { id: true, authorUserId: true },
    });
    if (!submission) throw new NotFoundError('Предложение не найдено.');
    if (submission.authorUserId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenError('Недостаточно прав для отправки сообщения.');
    }

    const attachments = await attachmentsForIds(tx, attachmentIds, user);
    const created = await tx.caseSubmissionMessage.create({
      data: {
        submissionId: parsed.data.submissionId,
        senderId: user.id,
        body: parsed.data.body.trim(),
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
      include: { sender: { select: { id: true, name: true, fullName: true, role: true } } },
    });
    await claimAttachments(tx, attachmentIds, user, created.id);
    await tx.caseSubmission.update({
      where: { id: parsed.data.submissionId },
      data: { updatedAt: new Date() },
    });
    return { created, attachments };
  });

  return {
    id: created.id,
    submissionId: created.submissionId,
    senderId: created.senderId,
    senderName: created.sender.fullName || created.sender.name,
    senderRole: created.sender.role,
    body: created.body,
    attachments,
    createdAt: created.createdAt.toISOString(),
  };
}

/**
 * Change a submission's status (new / in_review / accepted / rejected /
 * done). Admin only.
 */
export async function updateCaseSubmissionStatus(
  actor: Actor | null,
  submissionId: string,
  status: CaseSubmissionStatus,
): Promise<{ id: string; status: string }> {
  assertAdmin(actor, 'Менять статус может только администратор.');
  await prisma.caseSubmission.update({
    where: { id: submissionId },
    data: { status },
  });
  return { id: submissionId, status };
}

// ───────────────────────── Reads

/** The current actor's own submitted cases, most recently active first. */
export async function getMyCaseSubmissions(actor: Actor | null): Promise<SerializedCaseSubmission[]> {
  const user = assertApproved(actor, 'Требуется авторизация.');
  const rows = await prisma.caseSubmission.findMany({
    where: { authorUserId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: submissionInclude,
  });
  return rows.map(serializeSubmission);
}

/** Every submission across all users, most recently active first. Admin only. */
export async function getAllCaseSubmissions(actor: Actor | null): Promise<SerializedCaseSubmission[]> {
  assertAdmin(actor, 'Только администратор может видеть предложенные кейсы.');
  const rows = await prisma.caseSubmission.findMany({
    orderBy: { updatedAt: 'desc' },
    include: submissionInclude,
  });
  return rows.map(serializeSubmission);
}

/**
 * A single submission with its full message thread. The submission's own
 * author, or an admin, may view it — anyone else is forbidden. Preserves
 * the original Russian error text.
 */
export async function getCaseSubmissionById(
  actor: Actor | null,
  id: string,
): Promise<SerializedCaseSubmission> {
  const user = assertApproved(actor, 'Требуется авторизация.');
  const row = await prisma.caseSubmission.findUnique({
    where: { id },
    include: submissionInclude,
  });
  if (!row) throw new NotFoundError('Предложение не найдено.');
  if (row.authorUserId !== user.id && user.role !== 'ADMIN') {
    throw new ForbiddenError('Недостаточно прав для просмотра предложения.');
  }
  return serializeSubmission(row);
}
