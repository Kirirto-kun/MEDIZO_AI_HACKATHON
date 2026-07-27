import Constants from 'expo-constants';

/**
 * Base URL every `/api/...` call (REST auth endpoints + the tRPC batch
 * link) is prefixed with. Resolution order:
 *
 *  1. `app.json`'s `expo.extra.apiUrl` (read via `expo-constants` — this is
 *     how EAS build profiles will pin a per-environment URL at build time,
 *     see SP-4b Task 6's EAS config).
 *  2. `process.env.EXPO_PUBLIC_API_URL` (Expo's `EXPO_PUBLIC_`-prefixed env
 *     vars are inlined into the JS bundle by Metro at build time, so this
 *     works the same way in dev and in a built app).
 *  3. A development bundle uses `http://localhost:3000`; a production
 *     bundle fails safe to `https://docjob.kz` if no build-time URL was set.
 *
 * Resolved once at module load (not read on every call) since none of these
 * sources change at runtime.
 */
function resolveApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined;
  if (typeof extra?.apiUrl === 'string' && extra.apiUrl.trim().length > 0) {
    return extra.apiUrl.trim().replace(/\/+$/, '');
  }

  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  const developmentBuild =
    typeof __DEV__ !== 'undefined'
      ? __DEV__
      : process.env.NODE_ENV !== 'production';
  return developmentBuild ? 'http://localhost:3000' : 'https://docjob.kz';
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * Every `Serialized*` media field the API hands back (`Case.images[].url`,
 * `Case.attachments[].url`, `SerializedUser.profilePhotoUrl`,
 * `SerializedAnnouncement.imageUrl`, `BannerInfo.url`, ...) is a
 * server-relative path (`/api/images/<filename>`), matching how the web
 * client resolves them — a same-origin `<img src="/api/images/...">` just
 * works there because the browser is already on that origin. React Native
 * has no implicit origin, so any of these paths handed to RN's `<Image>` (or
 * `react-native-webview`) must be resolved against `API_BASE_URL` first, or
 * the load silently fails (a relative `uri` has nothing to resolve against).
 * Already-absolute URLs (`https://...`, e.g. a future S3-backed
 * `MediaStorage` returning a CDN link) pass through unchanged.
 */
export function resolveMediaUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
