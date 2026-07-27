/**
 * Accept only an absolute path on this origin. In particular, `//host/path`
 * is a protocol-relative external URL and must never be passed to the
 * router as a post-login destination.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    /[\u0000-\u001F\u007F\\]/.test(value)
  ) {
    return '/';
  }

  try {
    const base = new URL('https://docjob.invalid');
    const target = new URL(value, base);
    if (target.origin !== base.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
