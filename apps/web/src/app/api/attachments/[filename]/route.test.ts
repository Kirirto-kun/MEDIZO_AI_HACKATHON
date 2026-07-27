import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserFromRequestMock = vi.fn();
const findAttachmentMock = vi.fn();
const readAttachmentMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

vi.mock('@/lib/storage', () => ({
  readAttachment: (...args: unknown[]) => readAttachmentMock(...args),
}));

vi.mock('@docjob/db', () => ({
  prisma: {
    caseAttachment: {
      findFirst: (...args: unknown[]) => findAttachmentMock(...args),
    },
  },
}));

import { GET } from './route';

const request = new Request('https://example.test/api/attachments/evidence.pdf');
const context = { params: Promise.resolve({ filename: 'evidence.pdf' }) };

function user(
  id: string,
  role: 'ADMIN' | 'DOCTOR' | 'REVIEWER' = 'DOCTOR',
  approved = true,
) {
  return {
    id,
    role,
    approvedAt: approved ? new Date() : null,
  };
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    caseId: null,
    uploaderId: 'owner-id',
    submissionMessage: null,
    ...overrides,
  };
}

describe('GET /api/attachments/[filename]', () => {
  beforeEach(() => {
    getUserFromRequestMock.mockReset();
    findAttachmentMock.mockReset();
    readAttachmentMock.mockReset();
    readAttachmentMock.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: 'application/pdf',
    });
  });

  it('returns 401 without a session', async () => {
    getUserFromRequestMock.mockResolvedValue(null);

    const res = await GET(request, context);

    expect(res.status).toBe(401);
    expect(findAttachmentMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a pending account', async () => {
    getUserFromRequestMock.mockResolvedValue(user('owner-id', 'DOCTOR', false));

    const res = await GET(request, context);

    expect(res.status).toBe(403);
    expect(findAttachmentMock).not.toHaveBeenCalled();
  });

  it('returns 404 when there is no attachment record', async () => {
    getUserFromRequestMock.mockResolvedValue(user('owner-id'));
    findAttachmentMock.mockResolvedValue(null);

    const res = await GET(request, context);

    expect(res.status).toBe(404);
    expect(readAttachmentMock).not.toHaveBeenCalled();
  });

  it('lets an approved user read a catalog case attachment', async () => {
    getUserFromRequestMock.mockResolvedValue(user('reader-id'));
    findAttachmentMock.mockResolvedValue(attachment({ caseId: 'case-id' }));

    const res = await GET(request, context);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('lets the uploader read an unclaimed upload', async () => {
    getUserFromRequestMock.mockResolvedValue(user('owner-id'));
    findAttachmentMock.mockResolvedValue(attachment());

    const res = await GET(request, context);

    expect(res.status).toBe(200);
  });

  it('lets a submission author read a file claimed by their message', async () => {
    getUserFromRequestMock.mockResolvedValue(user('author-id'));
    findAttachmentMock.mockResolvedValue(
      attachment({
        uploaderId: 'another-id',
        submissionMessage: {
          submission: { authorUserId: 'author-id' },
        },
      }),
    );

    const res = await GET(request, context);

    expect(res.status).toBe(200);
  });

  it('denies another approved user access to a private submission upload', async () => {
    getUserFromRequestMock.mockResolvedValue(user('stranger-id'));
    findAttachmentMock.mockResolvedValue(
      attachment({
        submissionMessage: {
          submission: { authorUserId: 'author-id' },
        },
      }),
    );

    const res = await GET(request, context);

    expect(res.status).toBe(403);
    expect(readAttachmentMock).not.toHaveBeenCalled();
  });

  it('lets an admin read any recorded attachment', async () => {
    getUserFromRequestMock.mockResolvedValue(user('admin-id', 'ADMIN'));
    findAttachmentMock.mockResolvedValue(attachment({ uploaderId: 'another-id' }));

    const res = await GET(request, context);

    expect(res.status).toBe(200);
  });
});
