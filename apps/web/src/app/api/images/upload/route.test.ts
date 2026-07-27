import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserFromRequestMock = vi.fn();
const saveImageMock = vi.fn();
const limiterTakeMock = vi.fn();

vi.mock('@docjob/api/rate-limit', () => ({
  getFixedWindowLimiter: () => ({
    take: (...args: unknown[]) => limiterTakeMock(...args),
  }),
}));

vi.mock('@/lib/session', () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequestMock(...args),
}));

vi.mock('@/lib/storage', () => ({
  MAX_IMAGE_SIZE: 5 * 1024 * 1024,
  saveImage: (...args: unknown[]) => saveImageMock(...args),
}));

import { POST } from './route';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function user(role: 'ADMIN' | 'DOCTOR' | 'REVIEWER', approved = true) {
  return {
    id: `${role.toLowerCase()}-id`,
    role,
    approvedAt: approved ? new Date() : null,
  };
}

function uploadRequest(
  file: File = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' }),
  headers?: HeadersInit,
) {
  const formData = new FormData();
  formData.set('file', file);
  return new Request('https://example.test/api/images/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
}

describe('POST /api/images/upload', () => {
  beforeEach(() => {
    getUserFromRequestMock.mockReset();
    saveImageMock.mockReset();
    limiterTakeMock.mockReset();
    limiterTakeMock.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    saveImageMock.mockResolvedValue({
      filename: 'saved.png',
      mimeType: 'image/png',
      url: '/api/images/saved.png',
    });
  });

  it.each(['DOCTOR', 'REVIEWER', 'ADMIN'] as const)(
    'allows an approved %s to upload (preserving profile and admin callers)',
    async (role) => {
      getUserFromRequestMock.mockResolvedValue(user(role));
      const req = uploadRequest();

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(getUserFromRequestMock).toHaveBeenCalledWith(req);
      if (role === 'ADMIN') {
        expect(limiterTakeMock).not.toHaveBeenCalled();
      } else {
        expect(limiterTakeMock).toHaveBeenCalledWith(`${role.toLowerCase()}-id`);
      }
      expect(saveImageMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        'image/png',
      );
      expect(await res.json()).toEqual({
        filename: 'saved.png',
        mimeType: 'image/png',
        url: '/api/images/saved.png',
      });
    },
  );

  it('authenticates from the request carrying a Bearer token', async () => {
    getUserFromRequestMock.mockResolvedValue(user('DOCTOR'));
    const req = uploadRequest(undefined, { authorization: 'Bearer access-token' });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(getUserFromRequestMock).toHaveBeenCalledWith(req);
  });

  it('authenticates from the request carrying an access cookie', async () => {
    getUserFromRequestMock.mockResolvedValue(user('REVIEWER'));
    const req = uploadRequest(undefined, { cookie: 'docjob-access=access-token' });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(getUserFromRequestMock).toHaveBeenCalledWith(req);
  });

  it('returns 401 for an unauthenticated request', async () => {
    getUserFromRequestMock.mockResolvedValue(null);

    const res = await POST(uploadRequest());

    expect(res.status).toBe(401);
    expect(saveImageMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated but pending account', async () => {
    getUserFromRequestMock.mockResolvedValue(user('DOCTOR', false));

    const res = await POST(uploadRequest());

    expect(res.status).toBe(403);
    expect(saveImageMock).not.toHaveBeenCalled();
  });

  it('rejects SVG profile images from a non-admin account', async () => {
    getUserFromRequestMock.mockResolvedValue(user('DOCTOR'));
    const svg = new File(['<svg></svg>'], 'avatar.svg', {
      type: 'image/svg+xml',
    });

    const res = await POST(uploadRequest(svg));

    expect(res.status).toBe(400);
    expect(saveImageMock).not.toHaveBeenCalled();
  });

  it('preserves SVG upload support for an admin caller', async () => {
    getUserFromRequestMock.mockResolvedValue(user('ADMIN'));
    const svg = new File(['<svg></svg>'], 'admin-art.svg', {
      type: 'image/svg+xml',
    });
    saveImageMock.mockResolvedValue({
      filename: 'saved.svg',
      mimeType: 'image/svg+xml',
      url: '/api/images/saved.svg',
    });

    const res = await POST(uploadRequest(svg));

    expect(res.status).toBe(200);
    expect(saveImageMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/svg+xml',
    );
  });

  it('rejects an image over 5 MB before reading or saving it', async () => {
    getUserFromRequestMock.mockResolvedValue(user('DOCTOR'));
    const oversized = new File(
      [new Uint8Array(MAX_IMAGE_SIZE + 1)],
      'oversized.png',
      { type: 'image/png' },
    );

    const res = await POST(uploadRequest(oversized));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: 'Файл слишком большой (лимит 5 МБ).',
    });
    expect(saveImageMock).not.toHaveBeenCalled();
  });

  it('returns 429 when a non-admin has reached the image upload limit', async () => {
    getUserFromRequestMock.mockResolvedValue(user('REVIEWER'));
    limiterTakeMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 321 });

    const res = await POST(uploadRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('321');
    expect(saveImageMock).not.toHaveBeenCalled();
  });
});
