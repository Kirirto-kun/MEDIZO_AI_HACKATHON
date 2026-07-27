import { WebAppShell } from '../src/components/web-app-shell';

/**
 * One product surface, one source of truth. The native route files from the
 * first MVP remain in the repository temporarily for migration history, but
 * this root deliberately exposes no Expo Router slot: neither a restored
 * navigation state nor a deep link can reopen the divergent legacy screens.
 */
export default function RootLayout() {
  return <WebAppShell />;
}
