import { z } from 'zod';
import { prisma, Prisma, CaseMode as PrismaCaseMode } from '@docjob/db';
import { CASE_MODES, EMPTY_BODY, caseBodySchema, type CaseMode } from '@docjob/types';
import { assertAdmin, assertApproved, type Actor } from '../shared/actor';
import { NotFoundError, ValidationError } from '../shared/errors';
import {
  serializeCase,
  type SerializedCase,
  type SerializedCaseAttachment,
  type SerializedCaseListItem,
  type CasesPage,
} from './case.mapper';

// ───────────────────────── Validation schemas (moved verbatim from actions.ts)

const caseModeEnumSchema = z.enum(CASE_MODES);

const caseInputSchema = z.object({
  name: z.string().min(1),
  age: z.coerce.number().int().optional().nullable(),
  gender: z.string().optional().nullable(),
  primaryCondition: z.string().optional().nullable(),
  history: z.string().optional().nullable(),
  scenarioDescription: z.string().optional().nullable(),
  learningObjectives: z.array(z.string()).optional(),
  comorbidities: z.string().optional().nullable(),
  subgroup: z.string().optional().nullable(),
  specialty: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  teaser: z.string().optional().nullable(),
  mode: caseModeEnumSchema.optional(),
  body: caseBodySchema.optional(),
  imageIds: z.array(z.string()).optional(),
  imageFilenames: z.array(z.object({ filename: z.string(), mimeType: z.string() })).optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export type CreateCaseInput = z.infer<typeof caseInputSchema>;

const updateCaseSchema = caseInputSchema.partial().extend({ id: z.string() });
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

const listCasesPagedSchema = z.object({
  subgroup: z.string().optional(),
  specialty: z.string().optional(),
  mode: caseModeEnumSchema.optional(),
  search: z.string().optional(),
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
});
export type ListCasesPagedInput = z.infer<typeof listCasesPagedSchema>;

const updateCaseAttachmentSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  order: z.number().int().optional(),
});
export type UpdateCaseAttachmentInput = z.infer<typeof updateCaseAttachmentSchema>;

// ───────────────────────── Reads
//
// The original `getCases`/`getCasesPaged`/`getCaseById` server actions all
// gated on `requireUser()` (any logged-in user). We preserve that exactly
// via `assertApproved` — note this task's brief interface sketch omits the
// `actor` param on these three reads, but "behavior unchanged" wins: dropping
// the auth check here would be a real regression for any caller that doesn't
// itself re-check auth before calling into core.

/** List all cases, optionally filtered by subgroup/specialty. */
export async function listCases(
  actor: Actor | null,
  filters?: { subgroup?: string; specialty?: string },
): Promise<SerializedCase[]> {
  assertApproved(actor, 'Требуется авторизация.');
  const where: Prisma.CaseWhereInput = {};
  if (filters?.subgroup) where.subgroup = filters.subgroup;
  if (filters?.specialty) where.specialty = filters.specialty;
  const rows = await prisma.case.findMany({
    where,
    include: {
      images: { orderBy: { order: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeCase);
}

/** Offset-paginated case listing for the admin catalog / search UI. Keeps the existing page/pageSize contract (NOT cursor-based). */
export async function listCasesPaged(
  actor: Actor | null,
  input?: ListCasesPagedInput,
): Promise<CasesPage> {
  assertApproved(actor, 'Требуется авторизация.');

  const parsed = listCasesPagedSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ValidationError('Некорректные параметры запроса.');
  const { subgroup, specialty, mode, search } = parsed.data;

  const page = Math.max(1, parsed.data.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, parsed.data.pageSize ?? 20));

  const where: Prisma.CaseWhereInput = {};
  if (subgroup) where.subgroup = subgroup;
  if (specialty) where.specialty = specialty;
  if (mode) where.mode = mode as PrismaCaseMode;

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    where.OR = [
      { name: { contains: trimmedSearch, mode: 'insensitive' } },
      { teaser: { contains: trimmedSearch, mode: 'insensitive' } },
      { primaryCondition: { contains: trimmedSearch, mode: 'insensitive' } },
      { tags: { has: trimmedSearch } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.case.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        authorId: true,
        name: true,
        primaryCondition: true,
        subgroup: true,
        specialty: true,
        tags: true,
        teaser: true,
        mode: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.case.count({ where }),
  ]);

  const items: SerializedCaseListItem[] = rows.map((row) => ({
    id: row.id,
    authorId: row.authorId,
    name: row.name,
    primaryCondition: row.primaryCondition,
    subgroup: row.subgroup,
    specialty: row.specialty,
    tags: row.tags,
    teaser: row.teaser,
    mode: row.mode as CaseMode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Fetch a single case by id. Throws NotFoundError if it doesn't exist. */
export async function getCase(actor: Actor | null, id: string): Promise<SerializedCase> {
  assertApproved(actor, 'Требуется авторизация.');
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      images: { orderBy: { order: 'asc' } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!c) throw new NotFoundError('Кейс не найден.');
  return serializeCase(c);
}

// ───────────────────────── Writes

/** Create a new case. Admin only. */
export async function createCase(actor: Actor | null, input: CreateCaseInput): Promise<SerializedCase> {
  const author = assertAdmin(actor, 'Создавать кейсы может только администратор.');

  const parsed = caseInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Проверьте правильность заполнения формы кейса.');
  const data = parsed.data;
  const mode = (data.mode ?? 'CLINICAL_QUEST') as CaseMode;
  const attachmentIds = [...new Set(data.attachmentIds ?? [])];

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.case.create({
      data: {
        authorId: author.id,
        name: data.name,
        age: data.age ?? null,
        gender: data.gender ?? null,
        primaryCondition: data.primaryCondition ?? null,
        history: data.history ?? null,
        scenarioDescription: data.scenarioDescription ?? null,
        learningObjectives: data.learningObjectives ?? [],
        comorbidities: data.comorbidities ?? null,
        subgroup: data.subgroup ?? null,
        specialty: data.specialty ?? null,
        tags: data.tags ?? [],
        teaser: data.teaser ?? null,
        mode: mode as PrismaCaseMode,
        body: (data.body ?? EMPTY_BODY) as Prisma.InputJsonValue,
        images: data.imageFilenames && data.imageFilenames.length
          ? {
              create: data.imageFilenames.map((img, order) => ({
                filename: img.filename,
                mimeType: img.mimeType,
                order,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });
    if (attachmentIds.length) {
      const claimed = await tx.caseAttachment.updateMany({
        where: {
          id: { in: attachmentIds },
          caseId: null,
          submissionMessageId: null,
        },
        data: { caseId: row.id },
      });
      if (claimed.count !== attachmentIds.length) {
        throw new ValidationError('Один или несколько файлов уже используются.');
      }
    }
    return row;
  });

  const refreshed = await prisma.case.findUnique({
    where: { id: created.id },
    include: { images: true, attachments: { orderBy: { createdAt: 'asc' } } },
  });

  return serializeCase(refreshed!);
}

/**
 * Update an existing case. Admin only — matches `createCase`. (Previously
 * only required an approved/logged-in actor, mirroring the pre-refactor
 * `updateCase` server action's `requireUser()` gate; tightened to
 * `assertAdmin` as a security-hardening fix since every real caller —
 * `admin/cases/[id]/edit`, `admin/case-submissions`,
 * `attachments-manager` — is already admin-only.)
 */
export async function updateCase(actor: Actor | null, input: UpdateCaseInput): Promise<SerializedCase> {
  assertAdmin(actor, 'Редактировать кейсы может только администратор.');

  const parsed = updateCaseSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Некорректные данные кейса.');
  const {
    id,
    imageFilenames,
    imageIds: _discardImageIds,
    attachmentIds,
    body,
    mode,
    ...rest
  } = parsed.data;

  const updateData: Prisma.CaseUpdateInput = { ...(rest as Prisma.CaseUpdateInput) };
  if (mode) updateData.mode = mode as PrismaCaseMode;
  if (body) updateData.body = body as Prisma.InputJsonValue;
  const uniqueAttachmentIds = [...new Set(attachmentIds ?? [])];

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id },
      data: {
        ...updateData,
        ...(imageFilenames
          ? {
              images: {
                deleteMany: {},
                create: imageFilenames.map((img, order) => ({
                  filename: img.filename,
                  mimeType: img.mimeType,
                  order,
                })),
              },
            }
          : {}),
        embeddingDirty: true,
      },
    });
    if (uniqueAttachmentIds.length) {
      const claimed = await tx.caseAttachment.updateMany({
        where: {
          id: { in: uniqueAttachmentIds },
          caseId: null,
          submissionMessageId: null,
        },
        data: { caseId: id },
      });
      if (claimed.count !== uniqueAttachmentIds.length) {
        throw new ValidationError('Один или несколько файлов уже используются.');
      }
    }
  });

  const refreshed = await prisma.case.findUnique({
    where: { id },
    include: { images: true, attachments: { orderBy: { createdAt: 'asc' } } },
  });
  return serializeCase(refreshed!);
}

/** Delete a case. Admin only. */
export async function deleteCase(actor: Actor | null, id: string): Promise<{ id: string }> {
  assertAdmin(actor, 'Удалять кейсы может только администратор.');
  await prisma.case.delete({ where: { id } });
  return { id };
}

// ───────────────────────── Case attachments (admin)

/** Update a case attachment's title/description/order. Admin only. */
export async function updateCaseAttachment(
  actor: Actor | null,
  input: UpdateCaseAttachmentInput,
): Promise<SerializedCaseAttachment> {
  assertAdmin(actor, 'Редактировать вложения может только администратор.');
  const parsed = updateCaseAttachmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Некорректные данные вложения.');

  const data: Prisma.CaseAttachmentUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title?.trim() || null;
  if (parsed.data.description !== undefined) data.description = parsed.data.description?.trim() || null;
  if (parsed.data.order !== undefined) data.order = parsed.data.order;

  const existing = await prisma.caseAttachment.findFirst({
    // Admins edit both freshly uploaded (not yet attached to a case) files
    // and existing case files through the same authoring component. The
    // only forbidden records here are files claimed by a submission thread.
    where: { id: parsed.data.id, submissionMessageId: null },
  });
  if (!existing) throw new NotFoundError('Вложение кейса не найдено.');

  const updated = await prisma.caseAttachment.update({
    where: { id: parsed.data.id },
    data,
  });

  return {
    id: updated.id,
    filename: updated.filename,
    originalName: updated.originalName,
    title: updated.title,
    description: updated.description,
    mimeType: updated.mimeType,
    size: updated.size,
    kind: updated.kind,
    order: updated.order,
    url: `/api/attachments/${updated.filename}`,
    createdAt: updated.createdAt.toISOString(),
  };
}

/**
 * Delete a case attachment (DB row only). Admin only. Throws NotFoundError
 * if the attachment doesn't exist. Returns the deleted row's `filename` too
 * — the file itself lives on disk (UPLOAD_DIR), which is a transport-level
 * concern (the web app's storage helper); the web wrapper deletes the file
 * after this resolves, using the returned filename.
 */
export async function deleteCaseAttachment(
  actor: Actor | null,
  id: string,
): Promise<{ id: string; filename: string }> {
  assertAdmin(actor, 'Удалять вложения может только администратор.');
  const existing = await prisma.caseAttachment.findFirst({
    where: { id, submissionMessageId: null },
  });
  if (!existing) throw new NotFoundError('Вложение не найдено.');

  await prisma.caseAttachment.delete({ where: { id } });
  return { id, filename: existing.filename };
}

// ───────────────────────── Markdown import (admin)
//
// Re-exported here (same convention search.service.ts uses for
// ./search/embeddings) so `core.cases.structureCaseFromMarkdown(...)` works
// via the single `export * as cases from './cases/case.service'` barrel
// entry in index.ts, while the implementation itself lives in its own file
// (case-import.service.ts) per the SP-1b Task 8 brief.
export { structureCaseFromMarkdown, type StructureCaseInput } from './case-import.service';
