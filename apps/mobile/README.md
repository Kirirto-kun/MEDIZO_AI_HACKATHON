# DocJob Mobile (Expo)

DocJob Mobile is a hardened Expo shell around the responsive DocJob website.
Starting with `1.1.0 (versionCode 2)`, Android and web intentionally render the
same pages, forms, validation and role-specific capabilities from one source of
truth. This removes the UI drift that existed in the first native MVP.

Release `1.1.1 (versionCode 3)` replaces all Expo template artwork with the
DocJob launcher, adaptive, monochrome and splash assets.

The app:

- opens the configured DocJob HTTPS origin in `react-native-webview`;
- keeps only exact same-origin navigation inside the shell;
- opens safe external HTTP(S), email and telephone links with the OS;
- blocks unsafe schemes and file access;
- uses the website's HttpOnly cookie session;
- appends the stable `DocJobMobile/<version>` user-agent marker so the server
  exposes only DOCTOR and REVIEWER roles in the embedded surface;
- supports Android Back, retry/offline feedback, uploads and downloads;
- clears the old `1.0.0` SecureStore bearer-token session once during upgrade.

The old Expo Router screens remain temporarily as migration history, but the
root layout exposes no router slot, so restored navigation state and deep links
cannot reopen them. Admin remains available only in the normal web browser.

## Running locally

Set the web origin through `EXPO_PUBLIC_API_URL`:

```bash
EXPO_PUBLIC_API_URL=http://<reachable-host>:3000 pnpm --filter mobile dev
```

`localhost` works only when the emulator can reach the development server at
that address. A physical phone normally needs a LAN IP or HTTPS development
host.

## Verification

```bash
pnpm --filter mobile typecheck
pnpm --filter mobile lint
pnpm --filter mobile test -- --runInBand
EXPO_PUBLIC_API_URL=https://docjob.kz pnpm --filter mobile exec expo export --platform android
```

The tests cover the unified root, same-origin navigation policy, unsafe URL
blocking, legacy-token cleanup, retry state and Android Back behavior. The web
application owns the complete registration, login, dashboard, case, reviewer,
profile and localization test coverage.

An APK build must also be checked with Android build tools:

- package: `com.docjob.app`;
- version: `1.1.1 (3)`;
- minimum and target SDK;
- zip alignment;
- APK signature;
- signing certificate equality with `1.0.0 (1)`;
- full-file SHA-256 and exact byte size.

Keep the release signing key outside Git and outside the VPS. Reuse the same
key and increase `versionCode` for every update so Android can install it over
the prior APK.

## Direct APK and store builds

`eas.json` provides:

- `development` — development client;
- `preview` — internal APK;
- `direct` — directly installable production APK for `docjob.kz/download`;
- `production` — Android App Bundle / iOS store build.

The direct release points at `https://docjob.kz`. Store submission still
requires the owner's Expo/EAS, Google Play and Apple Developer accounts plus
store metadata and credentials. A real-device smoke test remains required
before publishing to a store; Jest and a local signed Gradle build do not
simulate keyboard, file chooser, Android DownloadManager or OEM WebView
behavior.
