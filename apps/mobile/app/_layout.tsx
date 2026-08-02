import { useState } from 'react';
import { WebAppShell } from '../src/components/web-app-shell';
import { AppErrorBoundary } from '../src/components/app-error-boundary';

/**
 * One product surface, one source of truth. The native route files from the
 * first MVP remain in the repository temporarily for migration history, but
 * this root deliberately exposes no Expo Router slot: neither a restored
 * navigation state nor a deep link can reopen the divergent legacy screens.
 */
export default function RootLayout() {
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);

  return (
    <AppErrorBoundary
      key={recoveryGeneration}
      onRecover={() => setRecoveryGeneration((current) => current + 1)}
    >
      <WebAppShell startInRecoveryMode={recoveryGeneration > 0} />
    </AppErrorBoundary>
  );
}
