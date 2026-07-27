import { NextResponse } from 'next/server';
import { prisma } from '@docjob/db';
import { readAttachment } from '@/lib/storage';
import { getUserFromRequest } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.approvedAt) {
    return NextResponse.json({ error: 'Account not approved' }, { status: 403 });
  }

  const { filename } = await params;
  const attachment = await prisma.caseAttachment.findFirst({
    where: { filename },
    select: {
      caseId: true,
      uploaderId: true,
      submissionMessage: {
        select: {
          submission: {
            select: { authorUserId: true },
          },
        },
      },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const canRead =
    user.role === 'ADMIN' ||
    attachment.caseId !== null ||
    attachment.uploaderId === user.id ||
    attachment.submissionMessage?.submission.authorUserId === user.id;
  if (!canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await readAttachment(filename);
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      'Content-Type': result.mimeType,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
