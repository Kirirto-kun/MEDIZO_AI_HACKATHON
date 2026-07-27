import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/session';
import { prisma, type Prisma } from '@docjob/db';
import {
  deleteAttachmentFile,
  MAX_ATTACHMENT_SIZE,
  saveAttachment,
} from '@/lib/storage';

export const runtime = 'nodejs';

const NON_ADMIN_DAILY_FILE_LIMIT = 30;
const NON_ADMIN_DAILY_BYTE_LIMIT = 250 * 1024 * 1024;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

class UploadQuotaExceededError extends Error {}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.approvedAt) {
    return NextResponse.json({ error: 'Account not approved' }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой (лимит 25 МБ).' },
        { status: 413 },
      );
    }
    if (user.role !== 'ADMIN' && file.type === 'image/svg+xml') {
      return NextResponse.json(
        { error: 'SVG доступен только администратору.' },
        { status: 400 },
      );
    }

    const titleRaw = formData.get('title');
    const descriptionRaw = formData.get('description');
    const title = typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw.trim() : null;
    const description = typeof descriptionRaw === 'string' && descriptionRaw.trim() ? descriptionRaw.trim() : null;

    const buffer = Buffer.from(await file.arrayBuffer());
    let savedFilename: string | null = null;
    let persisted;
    try {
      persisted = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          if (user.role !== 'ADMIN') {
            // Serialize uploads per user across every web instance. The
            // aggregate and insert then form one atomic quota reservation,
            // so parallel requests cannot all observe the same old count.
            await tx.$executeRawUnsafe(
              'SELECT pg_advisory_xact_lock(hashtext($1))',
              `docjob-attachment-upload:${user.id}`,
            );
            const recent = await tx.caseAttachment.aggregate({
              where: {
                uploaderId: user.id,
                createdAt: { gte: new Date(Date.now() - ONE_DAY_MS) },
              },
              _count: { _all: true },
              _sum: { size: true },
            });
            const recentFiles = recent._count._all;
            const recentBytes = recent._sum.size ?? 0;
            if (
              recentFiles >= NON_ADMIN_DAILY_FILE_LIMIT ||
              recentBytes + file.size > NON_ADMIN_DAILY_BYTE_LIMIT
            ) {
              throw new UploadQuotaExceededError();
            }
          }

          const saved = await saveAttachment(
            buffer,
            file.type || 'application/octet-stream',
          );
          savedFilename = saved.filename;
          const record = await tx.caseAttachment.create({
            data: {
              filename: saved.filename,
              originalName: file.name,
              title,
              description,
              mimeType: saved.mimeType,
              size: saved.size,
              kind: saved.kind,
              uploaderId: user.id,
            },
          });
          return { record, saved };
        },
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error) {
      if (savedFilename) await deleteAttachmentFile(savedFilename);
      if (error instanceof UploadQuotaExceededError) {
        return NextResponse.json(
          { error: 'Достигнут суточный лимит загрузки файлов.' },
          {
            status: 429,
            headers: { 'Retry-After': String(24 * 60 * 60) },
          },
        );
      }
      throw error;
    }
    const { record, saved } = persisted;

    return NextResponse.json({
      id: record.id,
      filename: saved.filename,
      originalName: file.name,
      title: record.title,
      description: record.description,
      mimeType: saved.mimeType,
      size: saved.size,
      kind: saved.kind,
      url: saved.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
