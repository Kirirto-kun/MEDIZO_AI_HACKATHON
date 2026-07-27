import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage', 'uploads');

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

async function ensureDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export async function saveImage(
  buffer: Buffer,
  mimeType: string
): Promise<{ filename: string; mimeType: string; url: string }> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
  if (buffer.byteLength > MAX_IMAGE_SIZE) {
    throw new Error('Файл слишком большой (лимит 5 МБ).');
  }
  await ensureDir();
  const ext = EXT_BY_MIME[mimeType];
  const filename = `${randomUUID()}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(fullPath, buffer);
  return { filename, mimeType, url: `/api/images/${filename}` };
}

export function getImageAbsolutePath(filename: string): string {
  const sanitized = path.basename(filename);
  if (sanitized !== filename) {
    throw new Error('Invalid filename');
  }
  return path.join(UPLOAD_DIR, sanitized);
}

export async function readImage(filename: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const fullPath = getImageAbsolutePath(filename);
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(filename).toLowerCase();
    const mimeType =
      Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ??
      'application/octet-stream';
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export async function deleteImage(filename: string): Promise<void> {
  try {
    const fullPath = getImageAbsolutePath(filename);
    await fs.unlink(fullPath);
  } catch {
    // ignore
  }
}

const ATTACHMENT_MIME_EXT: Record<string, string> = {
  ...EXT_BY_MIME,
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB

export type AttachmentKind = 'image' | 'pdf' | 'document' | 'other';

export function attachmentKindFromMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv'
  ) {
    return 'document';
  }
  return 'other';
}

export async function saveAttachment(
  buffer: Buffer,
  mimeType: string,
): Promise<{ filename: string; mimeType: string; size: number; kind: AttachmentKind; url: string }> {
  if (!ATTACHMENT_MIME_EXT[mimeType]) {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }
  if (buffer.byteLength > MAX_ATTACHMENT_SIZE) {
    throw new Error('Файл слишком большой (лимит 25 МБ).');
  }
  await ensureDir();
  const ext = ATTACHMENT_MIME_EXT[mimeType];
  const filename = `${randomUUID()}${ext}`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  await fs.writeFile(fullPath, buffer);
  return {
    filename,
    mimeType,
    size: buffer.byteLength,
    kind: attachmentKindFromMime(mimeType),
    url: `/api/attachments/${filename}`,
  };
}

export async function deleteAttachmentFile(filename: string): Promise<void> {
  try {
    const fullPath = getImageAbsolutePath(filename);
    await fs.unlink(fullPath);
  } catch {
    // ignore — file may already be gone
  }
}

export async function readAttachment(
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const fullPath = getImageAbsolutePath(filename); // shares the same UPLOAD_DIR + path-traversal guard
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(filename).toLowerCase();
    const mimeType =
      Object.entries(ATTACHMENT_MIME_EXT).find(([, e]) => e === ext)?.[0] ??
      'application/octet-stream';
    return { buffer, mimeType };
  } catch {
    return null;
  }
}
