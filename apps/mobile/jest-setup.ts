import { jest } from '@jest/globals';
// Side-effect import: initializes the global i18next singleton (RU default)
// synchronously before any test file's components render, so every
// `useTranslation()` call anywhere in the app resolves real copy without
// each test needing to wrap its render in an `I18nextProvider` — mirrors how
// `app-providers.tsx` wires the same module for the real app. jest-expo's
// `setupFilesAfterEnv` runs this once per test FILE (not once globally), but
// `./src/i18n`'s own `initialized` guard makes repeated execution a no-op
// after the first import within each file's module registry. Written above
// the `jest.mock()` calls below only to satisfy ESLint's `import/first` —
// Jest's babel-plugin-jest-hoist hoists every `jest.mock()` call above ALL
// imports in this module at transform time regardless of source position
// (same convention `src/lib/token-store.test.ts` documents), so this import
// still only actually runs once `expo-localization`/`@react-native-async-storage/async-storage`
// are mocked below.
import './src/i18n';

// `@react-native-async-storage/async-storage` ships its own official Jest
// mock (an in-memory Map standing in for the native Keychain-adjacent
// layer) but — like `expo-secure-store` (see `src/lib/token-store.test.ts`)
// — nothing auto-wires it under jest-expo; every consumer needs it mocked
// explicitly. Two consumers depend on it as of SP-4b Task 6: `./src/i18n`
// (persists the language toggle, imported above) and `./src/lib/query-persist.ts`
// (the offline React Query cache) — both are exercised across many test
// files, so this is mocked globally here rather than per-file.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the jest.mock factory must be synchronous; see app/case/[id].test.tsx for the same pattern
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// `expo-localization`'s real native module has no jest-expo auto-mock in
// this monorepo setup (confirmed: no jest field wiring it in, unlike some
// Expo packages) — mocked globally for the same reason as AsyncStorage
// above. Returns a non-ru/kk locale (`en`) deliberately, so every test run
// exercises `./src/i18n`'s documented fallback-to-`ru` path rather than
// coincidentally matching one of the two supported languages — keeps the
// existing Russian-substring test assertions across the app (login/pending/
// tabs/etc., predating this task) meaningful and stable.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

// The unified app root now always mounts react-native-webview. Jest has no
// native RNCWebViewModule, so expose a host View that retains all props for
// route-shell and component assertions. Tests that need a specialised HTML
// projection can still override this mock locally.
jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    WebView: React.forwardRef(function MockWebView(
      props: Record<string, unknown>,
      ref: React.ForwardedRef<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({
        goBack: jest.fn(),
        reload: jest.fn(),
      }));
      return React.createElement(View, props);
    }),
  };
});
