'use client';

import { useEffect } from 'react';
import { SessionRecoveryScreen } from '@/components/session-recovery-screen';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('DocJob route error', error);
  }, [error]);

  return <SessionRecoveryScreen reset={reset} />;
}
