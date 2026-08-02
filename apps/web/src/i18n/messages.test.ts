import { describe, expect, it } from 'vitest';

import kk from './messages/kk.json';
import ru from './messages/ru.json';

describe('login recovery messages', () => {
  it.each([
    ['ru', ru],
    ['kk', kk],
  ])('keeps recovery copy in the auth.login namespace for %s', (_locale, messages) => {
    expect(messages.auth.login.restore.loading).toBeTruthy();
    expect(messages.auth.login.restore.useAnotherAccount).toBeTruthy();
  });
});
