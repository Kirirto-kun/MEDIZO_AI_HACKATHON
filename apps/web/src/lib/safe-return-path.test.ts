import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-return-path';

describe('safeReturnPath', () => {
  it('preserves local paths including a query string', () => {
    expect(safeReturnPath('/cases/clinical/123?tab=chat')).toBe(
      '/cases/clinical/123?tab=chat',
    );
  });

  it.each([
    undefined,
    null,
    '',
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example/path',
    '/\n/evil.example/path',
    'javascript:alert(1)',
  ])('falls back to / for unsafe destination %s', (value) => {
    expect(safeReturnPath(value)).toBe('/');
  });
});
