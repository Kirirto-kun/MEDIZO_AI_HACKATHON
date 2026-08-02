'use client';

import { useState } from 'react';
import { LogIn, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DocJobLogo } from '@/components/icons';
import { recoverBrowserSession } from '@/lib/session-recovery';

type SessionRecoveryScreenProps = {
  reset: () => void;
};

export function SessionRecoveryScreen({ reset }: SessionRecoveryScreenProps) {
  const [isRecovering, setIsRecovering] = useState(false);

  const recover = async () => {
    if (isRecovering) return;
    setIsRecovering(true);
    await recoverBrowserSession();
  };

  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 text-center shadow-2xl sm:p-8">
        <DocJobLogo className="mx-auto h-14 w-14 text-primary" />
        <h1 className="mt-5 break-words font-headline text-xl font-semibold sm:text-2xl">
          DocJob не смог открыть этот экран
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Попробуйте загрузить страницу ещё раз. Если проблема повторяется,
          очистите текущую сессию и войдите заново.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="outline" className="min-w-0 flex-1" onClick={reset}>
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span className="min-w-0 whitespace-normal">Повторить</span>
          </Button>
          <Button
            type="button"
            className="min-w-0 flex-1"
            disabled={isRecovering}
            onClick={() => void recover()}
          >
            <LogIn className="h-4 w-4 shrink-0" />
            <span className="min-w-0 whitespace-normal">
              {isRecovering ? 'Открываем вход…' : 'Войти заново'}
            </span>
          </Button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground/80">
          Қайта кіру ағымдағы сессияны тазартып, кіру бетіне қайтарады.
        </p>
      </section>
    </main>
  );
}
