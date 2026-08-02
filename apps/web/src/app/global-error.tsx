'use client';

import { useEffect, useState } from 'react';
import { recoverBrowserSession } from '@/lib/session-recovery';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    console.error('DocJob root error', error);
  }, [error]);

  const recover = async () => {
    if (isRecovering) return;
    setIsRecovering(true);
    await recoverBrowserSession();
  };

  return (
    <html lang="ru" className="dark">
      <body style={{ margin: 0, background: '#051620', color: '#f8fafc', fontFamily: 'Arial, sans-serif' }}>
        <main
          style={{
            minHeight: '100svh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            overflow: 'hidden',
            padding: 16,
          }}
        >
          <section
            style={{
              width: '100%',
              maxWidth: 420,
              boxSizing: 'border-box',
              border: '1px solid rgba(34, 211, 238, 0.35)',
              borderRadius: 20,
              background: '#0b2130',
              padding: 24,
              textAlign: 'center',
              boxShadow: '0 24px 70px rgba(0,0,0,.45)',
            }}
          >
            {/* A root error boundary must not depend on Next's image runtime. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo_dj.jpg?v=20260602"
              alt="DocJob"
              width={56}
              height={56}
              style={{ borderRadius: 14 }}
            />
            <h1 style={{ margin: '20px 0 0', fontSize: 22, lineHeight: 1.25 }}>
              Не удалось открыть DocJob
            </h1>
            <p style={{ margin: '12px 0 0', color: '#a8b6c1', fontSize: 14, lineHeight: 1.55 }}>
              Повторите загрузку или очистите текущую сессию и войдите заново.
            </p>
            <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
              <button type="button" onClick={reset} style={secondaryButtonStyle}>
                Повторить
              </button>
              <button
                type="button"
                disabled={isRecovering}
                onClick={() => void recover()}
                style={primaryButtonStyle}
              >
                {isRecovering ? 'Открываем вход…' : 'Войти заново'}
              </button>
            </div>
            <p style={{ margin: '18px 0 0', color: '#78909c', fontSize: 12, lineHeight: 1.5 }}>
              Қайта кіру ағымдағы сессияны тазартады.
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}

const sharedButtonStyle = {
  width: '100%',
  minHeight: 44,
  boxSizing: 'border-box',
  borderRadius: 10,
  padding: '10px 16px',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
} as const;

const secondaryButtonStyle = {
  ...sharedButtonStyle,
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'transparent',
  color: '#f8fafc',
} as const;

const primaryButtonStyle = {
  ...sharedButtonStyle,
  border: '1px solid #22d3ee',
  background: '#22d3ee',
  color: '#051620',
} as const;
