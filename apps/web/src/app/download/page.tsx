import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Mail,
  Rocket,
  ShieldCheck,
  Smartphone,
  TabletSmartphone,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DocJobLogo } from '@/components/icons';
import { LanguageSwitcher } from '@/components/language-switcher';
import { getMobileAppLinks, type AndroidAppRelease } from '@/lib/mobile-app-links';
import { SITE_EMAIL, SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([
    getTranslations('download.metadata'),
    getLocale(),
  ]);
  const title = t('title');
  const description = t('description');

  return {
    title,
    description,
    alternates: { canonical: '/download' },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: locale === 'kk' ? 'kk_KZ' : 'ru_RU',
      url: `${SITE_URL}/download`,
      title,
      description,
      images: [{ url: '/logo_dj.jpg', alt: SITE_NAME }],
    },
  };
}

type Platform = {
  key: 'android' | 'ios';
  icon: LucideIcon;
  href: string | null;
  title: string;
  description: string;
  action: string;
  unavailable: string;
  release?: AndroidAppRelease;
};

export default async function DownloadPage() {
  const [t, locale] = await Promise.all([getTranslations('download'), getLocale()]);
  const links = getMobileAppLinks();
  const platforms: Platform[] = [
    {
      key: 'android',
      icon: Smartphone,
      href: links.android?.url ?? null,
      title: t('platforms.android.title'),
      description: t('platforms.android.description'),
      action: t('platforms.android.action'),
      unavailable: t('platforms.android.unavailable'),
      release: links.android ?? undefined,
    },
    {
      key: 'ios',
      icon: TabletSmartphone,
      href: null,
      title: t('platforms.ios.title'),
      description: t('platforms.ios.description'),
      action: t('platforms.ios.action'),
      unavailable: t('platforms.ios.unavailable'),
    },
  ];
  const stepKeys = ['invite', 'install', 'feedback'] as const;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link href="/landing" className="flex items-center gap-3" aria-label="DocJob">
            <DocJobLogo className="h-8 w-8 text-primary" />
            <span className="font-headline text-lg font-semibold text-primary">DocJob</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <Button asChild variant="ghost" size="sm">
              <Link href="/landing">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">{t('header.back')}</span>
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden px-5 py-16 text-center sm:px-6 md:py-24">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-96 max-w-4xl opacity-20 blur-3xl"
            style={{
              background: 'radial-gradient(circle, hsl(var(--primary)), transparent 68%)',
            }}
          />
          <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6">
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/10 px-4 py-1.5 text-primary"
            >
              <Rocket className="mr-2 h-3.5 w-3.5" />
              {t('hero.badge')}
            </Badge>
            <h1 className="font-headline text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              {t('hero.title')}
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              {t(links.android ? 'hero.descriptionAvailable' : 'hero.descriptionPreparing')}
            </p>
          </div>
        </section>

        <section className="px-5 pb-16 sm:px-6 md:pb-24">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 text-center">
              <h2 className="font-headline text-2xl font-semibold md:text-3xl">
                {t('platforms.title')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground md:text-base">
                {t('platforms.subtitle')}
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {platforms.map((platform) => {
                const Icon = platform.icon;
                const available = platform.href !== null;
                const sizeMegabytes = platform.release
                  ? new Intl.NumberFormat(locale, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }).format(platform.release.sizeBytes / 1024 / 1024)
                  : null;

                return (
                  <Card
                    key={platform.key}
                    className="flex flex-col border-border/60 bg-card/70 p-6 md:p-7"
                  >
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/30 bg-primary/10">
                        {platform.key === 'android' ? (
                          <DocJobLogo className="h-12 w-12 rounded-xl" />
                        ) : (
                          <Icon className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <Badge
                        variant={available ? 'secondary' : 'outline'}
                        className={
                          available
                            ? 'border-primary/20 bg-primary/10 text-primary'
                            : 'text-muted-foreground'
                        }
                      >
                        {available ? (
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Clock3 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {available ? t('platforms.available') : t('platforms.preparing')}
                      </Badge>
                    </div>

                    <h3 className="font-headline text-xl font-semibold">{platform.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {platform.description}
                    </p>

                    {platform.release && sizeMegabytes ? (
                      <div className="mt-5 rounded-xl border border-border/60 bg-background/40 p-4">
                        <h4 className="text-sm font-semibold">
                          {t('platforms.android.release.title')}
                        </h4>
                        <dl className="mt-3 grid gap-2 text-xs sm:text-sm">
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-muted-foreground">
                              {t('platforms.android.release.version')}
                            </dt>
                            <dd className="text-right font-medium">
                              {platform.release.version}{' '}
                              <span className="text-muted-foreground">
                                {t('platforms.android.release.build', {
                                  code: platform.release.versionCode,
                                })}
                              </span>
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-4">
                            <dt className="text-muted-foreground">
                              {t('platforms.android.release.size')}
                            </dt>
                            <dd className="font-medium">
                              {t('platforms.android.release.sizeValue', {
                                size: sizeMegabytes,
                              })}
                            </dd>
                          </div>
                          <div className="grid gap-1">
                            <dt className="text-muted-foreground">
                              {t('platforms.android.release.checksum')}
                            </dt>
                            <dd>
                              <code className="block break-all rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                                {platform.release.sha256}
                              </code>
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                          {t('platforms.android.release.installHint')}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-6">
                      {platform.href && platform.release ? (
                        <Button asChild size="lg" className="w-full">
                          <a
                            href={platform.href}
                            download={`DocJob-${platform.release.version}.apk`}
                          >
                            {platform.action}
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : platform.href ? (
                        <Button asChild size="lg" className="w-full">
                          <a href={platform.href} target="_blank" rel="noopener noreferrer">
                            {platform.action}
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : (
                        <Button type="button" size="lg" className="w-full" disabled>
                          <Clock3 className="h-4 w-4" />
                          {platform.unavailable}
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <Separator className="opacity-30" />

        <section className="px-5 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 max-w-2xl">
              <Badge variant="outline" className="mb-3 border-accent/40 bg-accent/10 text-accent">
                {t('earlyAccess.badge')}
              </Badge>
              <h2 className="font-headline text-2xl font-semibold md:text-3xl">
                {t('earlyAccess.title')}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                {t('earlyAccess.description')}
              </p>
            </div>

            <ol className="grid gap-4 md:grid-cols-3">
              {stepKeys.map((step, index) => (
                <li key={step} className="rounded-xl border border-border/60 bg-card/50 p-5">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {index + 1}
                  </div>
                  <h3 className="font-semibold">{t(`earlyAccess.steps.${step}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`earlyAccess.steps.${step}.description`)}
                  </p>
                </li>
              ))}
            </ol>

            <Card className="mt-6 border-primary/30 bg-primary/5 p-5 md:p-6">
              <div className="flex items-start gap-4">
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
                <div>
                  <h3 className="font-semibold">{t('safety.title')}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t('safety.description')}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <Separator className="opacity-30" />

        <section className="px-5 py-16 sm:px-6 md:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-headline text-2xl font-semibold md:text-3xl">
              {t('webFallback.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {t('webFallback.description')}
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/register">{t('webFallback.action')}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={`mailto:${SITE_EMAIL}`}>
                  <Mail className="h-4 w-4" />
                  {t('webFallback.feedback')}
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 px-5 py-7 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <DocJobLogo className="h-5 w-5 text-primary" />
            <span>DocJob © {new Date().getFullYear()}</span>
          </div>
          <Link href="/landing" className="transition-colors hover:text-foreground">
            {t('footer.home')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
