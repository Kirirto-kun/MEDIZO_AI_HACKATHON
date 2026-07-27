import { NextResponse } from 'next/server';
import { getFixedWindowLimiter } from '@docjob/api/rate-limit';
import { getUserFromRequest } from '@/lib/session';
import { MAX_IMAGE_SIZE, saveImage } from '@/lib/storage';

export const runtime = 'nodejs';

const imageUploadLimiter = getFixedWindowLimiter({
  max: 20,
  windowMs: 24 * 60 * 60 * 1000,
  namespace: 'image-upload',
});

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.approvedAt) {
    return NextResponse.json({ error: 'Account not approved' }, { status: 403 });
  }
  if (user.role !== 'ADMIN') {
    const limit = await imageUploadLimiter.take(user.id);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Достигнут суточный лимит загрузки изображений.' },
        {
          status: 429,
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        },
      );
    }
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (user.role !== 'ADMIN' && file.type === 'image/svg+xml') {
      return NextResponse.json(
        { error: 'SVG доступен только администратору.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой (лимит 5 МБ).' },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveImage(buffer, file.type);

    return NextResponse.json({
      filename: saved.filename,
      mimeType: saved.mimeType,
      url: saved.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
