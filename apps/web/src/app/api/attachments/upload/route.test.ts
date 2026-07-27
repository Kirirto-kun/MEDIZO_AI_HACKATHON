import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserFromRequestMock = vi.fn();
const saveAttachmentMock = vi.fn();
const deleteAttachmentFileMock = vi.fn();
const createAttachmentMock = vi.fn();
const aggregateAttachmentsMock = vi.fn();
const executeRawMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

vi.mock('@/lib/storage', () => ({
  MAX_ATTACHMENT_SIZE: 25 * 1024 * 1024,
  saveAttachment: (...args: unknown[]) => saveAttachmentMock(...args),
  deleteAttachmentFile: (...args: unknown[]) => deleteAttachmentFileMock(...args),
}));

vi.mock('@docjob/db', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import { POST } from './route';

function user(role: 'ADMIN' | 'DOCTOR' | 'REVIEWER', approved = true) {
  return {
    id: `${role.toLowerCase()}-id`,
    role,
    approvedAt: approved ? new Date() : null,
  };
}

function uploadRequest(
  headers?: HeadersInit,
  file: File = new File([new Uint8Array([1, 2, 3])], 'case.pdf', {
    type: 'application/pdf',
  }),
) {
  const formData = new FormData();
  formData.set('file', file);
  formData.set('title', 'Lab results');
  formData.set('description', 'Supporting document');
  return new Request('https://example.test/api/attachments/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
}

describe('POST /api/attachments/upload', () => {
  beforeEach(() => {
    getUserFromRequestMock.mockReset();
    saveAttachmentMock.mockReset();
    deleteAttachmentFileMock.mockReset();
    createAttachmentMock.mockReset();
    aggregateAttachmentsMock.mockReset();
    executeRawMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockImplementation(
      async (
        callback: (tx: unknown) => Promise<unknown>,
      ) =>
        callback({
          $executeRawUnsafe: (...args: unknown[]) => executeRawMock(...args),
          caseAttachment: {
            create: (...args: unknown[]) => createAttachmentMock(...args),
            aggregate: (...args: unknown[]) => aggregateAttachmentsMock(...args),
          },
        }),
    );
    executeRawMock.mockResolvedValue(1);
    aggregateAttachmentsMock.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { size: null },
    });
    saveAttachmentMock.mockResolvedValue({
      filename: 'saved.pdf',
      mimeType: 'application/pdf',
      size: 3,
      kind: 'pdf',
      url: '/api/attachments/saved.pdf',
    });
    createAttachmentMock.mockResolvedValue({
      id: 'attachment-id',
      title: 'Lab results',
      description: 'Supporting document',
    });
  });

  it.each(['DOCTOR', 'REVIEWER', 'ADMIN'] as const)(
    'allows an approved %s and records that user as uploader',
    async (role) => {
      const actor = user(role);
      getUserFromRequestMock.mockResolvedValue(actor);
      const req = uploadRequest(
        role === 'DOCTOR'
          ? { authorization: 'Bearer access-token' }
          : { cookie: 'docjob-access=access-token' },
      );

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(getUserFromRequestMock).toHaveBeenCalledWith(req);
      if (role === 'ADMIN') {
        expect(aggregateAttachmentsMock).not.toHaveBeenCalled();
        expect(executeRawMock).not.toHaveBeenCalled();
      } else {
        expect(executeRawMock).toHaveBeenCalledWith(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          `docjob-attachment-upload:${actor.id}`,
        );
        expect(aggregateAttachmentsMock).toHaveBeenCalledWith({
          where: {
            uploaderId: actor.id,
            createdAt: { gte: expect.any(Date) },
          },
          _count: { _all: true },
          _sum: { size: true },
        });
      }
      expect(createAttachmentMock).toHaveBeenCalledWith({
        data: {
          filename: 'saved.pdf',
          originalName: 'case.pdf',
          title: 'Lab results',
          description: 'Supporting document',
          mimeType: 'application/pdf',
          size: 3,
          kind: 'pdf',
          uploaderId: actor.id,
        },
      });
      expect(await res.json()).toMatchObject({
        id: 'attachment-id',
        filename: 'saved.pdf',
        originalName: 'case.pdf',
      });
    },
  );

  it('returns 401 for an unauthenticated request', async () => {
    getUserFromRequestMock.mockResolvedValue(null);

    const res = await POST(uploadRequest());

    expect(res.status).toBe(401);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated but pending account', async () => {
    getUserFromRequestMock.mockResolvedValue(user('REVIEWER', false));

    const res = await POST(uploadRequest());

    expect(res.status).toBe(403);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it('rejects an SVG attachment from a non-admin account', async () => {
    getUserFromRequestMock.mockResolvedValue(user('REVIEWER'));
    const svg = new File(['<svg></svg>'], 'evidence.svg', {
      type: 'image/svg+xml',
    });

    const res = await POST(uploadRequest(undefined, svg));

    expect(res.status).toBe(400);
    expect(saveAttachmentMock).not.toHaveBeenCalled();
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it('preserves SVG attachment upload support for admin case authoring', async () => {
    getUserFromRequestMock.mockResolvedValue(user('ADMIN'));
    const svg = new File(['<svg></svg>'], 'case-figure.svg', {
      type: 'image/svg+xml',
    });
    saveAttachmentMock.mockResolvedValue({
      filename: 'saved.svg',
      mimeType: 'image/svg+xml',
      size: 11,
      kind: 'image',
      url: '/api/attachments/saved.svg',
    });
    createAttachmentMock.mockResolvedValue({
      id: 'svg-attachment-id',
      title: 'Lab results',
      description: 'Supporting document',
    });

    const res = await POST(uploadRequest(undefined, svg));

    expect(res.status).toBe(200);
    expect(saveAttachmentMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/svg+xml',
    );
  });

  it('returns 429 before saving when a non-admin has reached the daily quota', async () => {
    getUserFromRequestMock.mockResolvedValue(user('DOCTOR'));
    aggregateAttachmentsMock.mockResolvedValue({
      _count: { _all: 30 },
      _sum: { size: 30 },
    });

    const res = await POST(uploadRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('86400');
    expect(saveAttachmentMock).not.toHaveBeenCalled();
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it('removes the saved file if the database record cannot be created', async () => {
    getUserFromRequestMock.mockResolvedValue(user('REVIEWER'));
    createAttachmentMock.mockRejectedValue(new Error('database unavailable'));

    const res = await POST(uploadRequest());

    expect(res.status).toBe(400);
    expect(deleteAttachmentFileMock).toHaveBeenCalledWith('saved.pdf');
  });
});
