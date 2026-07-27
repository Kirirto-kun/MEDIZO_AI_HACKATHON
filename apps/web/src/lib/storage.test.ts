import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_SIZE, saveImage } from './storage';

describe('web image storage limits', () => {
  it('rejects an image over the 5 MB cap even if a caller bypasses the route guard', async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_SIZE + 1);

    await expect(saveImage(oversized, 'image/png')).rejects.toThrow(
      'Файл слишком большой (лимит 5 МБ).',
    );
  });
});
