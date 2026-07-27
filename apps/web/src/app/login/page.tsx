'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/hooks/use-toast';
import { DocJobLogo } from '@/components/icons';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Loader2 } from 'lucide-react';
import { useUserStore } from '@/hooks/use-user-store';
import { safeReturnPath } from '@/lib/safe-return-path';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { login } = useUserStore();
  const t = useTranslations('auth.login');
  const [isLoading, setIsLoading] = useState(false);
  const justRegistered = searchParams.get('pending') === '1';
  const mobileAdminBlocked = searchParams.get('mobileAdmin') === '1';
  const callbackUrl = safeReturnPath(searchParams.get('callbackUrl'));
  const [isRestoringSession, setIsRestoringSession] = useState(
    !justRegistered && !mobileAdminBlocked,
  );

  useEffect(() => {
    if (justRegistered || mobileAdminBlocked) {
      setIsRestoringSession(false);
      return;
    }

    let active = true;
    setIsRestoringSession(true);
    void fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!active) return;
        if (res.ok) {
          // A full document navigation remounts the root UserProvider. A
          // client-only router transition would keep the parallel, earlier
          // `/api/auth/me` result (`null` from the expired access cookie)
          // and immediately bounce the restored session back to /login.
          window.location.replace(callbackUrl);
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => ({}))) as { status?: string };
          if (body.status === 'unsupported_role') {
            window.location.replace('/login?mobileAdmin=1');
          }
        }
      })
      .catch(() => {
        // Keep the login form usable when session restoration is unavailable.
      })
      .finally(() => {
        if (active) setIsRestoringSession(false);
      });

    return () => {
      active = false;
    };
  }, [callbackUrl, justRegistered, mobileAdminBlocked]);

  const loginSchema = z.object({
    email: z.string().email(t('errors.emailInvalid')),
    password: z.string().min(1, t('errors.passwordRequired')),
  });
  type LoginFormValues = z.infer<typeof loginSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    const res = await login(data.email, data.password);
    setIsLoading(false);

    if (res.ok) {
      toast({ title: t('toast.successTitle'), description: t('toast.successDescription') });
      router.push(callbackUrl);
      router.refresh();
    } else {
      const isPending = res.reason === 'pending';
      const isUnsupportedRole = res.reason === 'unsupported_role';
      toast({
        variant: 'destructive',
        title: isPending
          ? t('toast.pendingTitle')
          : isUnsupportedRole
            ? t('toast.mobileAdminTitle')
            : t('toast.failTitle'),
        description: isPending
          ? t('toast.pendingDescription')
          : isUnsupportedRole
            ? t('toast.mobileAdminDescription')
          : (res.error ?? t('toast.failDescription')),
      });
    }
  };

  if (isRestoringSession) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {justRegistered ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-medium">{t('pendingBanner.title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/85">
            {t('pendingBanner.body')}
          </p>
        </div>
      ) : null}
      {mobileAdminBlocked ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <p className="font-medium">{t('mobileAdminBanner.title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/85">
            {t('mobileAdminBanner.body')}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">{t('emailLabel')}</Label>
        <Input id="email" type="email" placeholder={t('emailPlaceholder')} {...register('email')} />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('passwordLabel')}</Label>
        <PasswordInput id="password" {...register('password')} />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t('submit')}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const t = useTranslations('auth.login');
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 pt-16 sm:pt-4">
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher variant="outline" />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <DocJobLogo className="h-16 w-16" />
          </div>
          <CardTitle className="text-2xl font-headline">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="text-center text-sm text-muted-foreground">{t('loading')}</div>}>
            <LoginForm />
          </Suspense>
          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">{t('noAccount')} </span>
            <Link href="/register" className="text-primary hover:underline">
              {t('registerCta')}
            </Link>
          </div>
          <div className="mt-3 text-center text-sm">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline">
              {t('forgotPassword')}
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <Link href="/legal/terms" className="hover:underline">
              {t('legal.terms')}
            </Link>
            <span aria-hidden>·</span>
            <Link href="/legal/privacy" className="hover:underline">
              {t('legal.privacy')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
