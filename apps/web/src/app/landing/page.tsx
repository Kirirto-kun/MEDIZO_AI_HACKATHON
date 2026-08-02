import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  Activity,
  ArrowRight,
  Brain,
  CalendarDays,
  Clock,
  Globe2,
  HeartPulse,
  Mail,
  MapPin,
  Newspaper,
  Search,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Stethoscope,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { DocJobLogo } from '@/components/icons';
import { LanguageSwitcher } from '@/components/language-switcher';
import { CyclingWord } from '@/components/cycling-word';
import { LandingContactForm } from '@/components/landing/contact-form';
import { getPublicNewsItems } from '@/lib/news';
import { SITE_EMAIL, SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing.metadata');
  const title = t('title');
  const description = t('description');
  return {
    title,
    description,
    alternates: { canonical: '/landing' },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'ru_RU',
      url: `${SITE_URL}/landing`,
      title,
      description,
      images: [{ url: '/logo_dj.jpg', alt: SITE_NAME }],
    },
  };
}

const ECG_PATH =
  'M0,30 L30,30 L38,30 L42,10 L46,50 L50,20 L54,38 L58,30 L90,30 L98,30 L102,10 L106,50 L110,20 L114,38 L118,30 L150,30 L158,30 L162,10 L166,50 L170,20 L174,38 L178,30 L210,30 L218,30 L222,10 L226,50 L230,20 L234,38 L238,30 L270,30 L278,30 L282,10 L286,50 L290,20 L294,38 L298,30 L330,30 L338,30 L342,10 L346,50 L350,20 L354,38 L358,30 L400,30';

type DirectionKey = 'clinical' | 'sanepid' | 'bestPractice' | 'management';
type CapabilityKey = 'international' | 'ai' | 'allTime' | 'scaling';
type LandingNewsItem = {
  id: string;
  title: string;
  body: string;
  date: string;
};

const directionIcons: Record<DirectionKey, LucideIcon> = {
  clinical: Stethoscope,
  sanepid: ShieldAlert,
  bestPractice: Sparkles,
  management: TrendingUp,
};

const capabilityIcons: Record<CapabilityKey, LucideIcon> = {
  international: Globe2,
  ai: Brain,
  allTime: Clock,
  scaling: Activity,
};

const directionKeys: DirectionKey[] = ['clinical', 'sanepid', 'bestPractice', 'management'];
const capabilityKeys: CapabilityKey[] = ['international', 'ai', 'allTime', 'scaling'];

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const newsItems = await getLandingNewsItems();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'EducationalOrganization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/logo_dj.jpg`,
        email: SITE_EMAIL,
        description: t('metadata.description'),
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        inLanguage: 'ru-RU',
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
    ],
  };

  const directions = directionKeys.map((k) => ({
    key: k,
    icon: directionIcons[k],
    title: t(`directions.${k}.title`),
    description: t(`directions.${k}.description`),
  }));

  const capabilities = capabilityKeys.map((k) => ({
    key: k,
    icon: capabilityIcons[k],
    title: t(`capabilities.${k}.title`),
    description: t(`capabilities.${k}.description`),
  }));

  return (
    <div className="flex min-h-screen min-h-svh w-full min-w-0 max-w-full flex-col overflow-x-clip bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <DocJobLogo className="h-8 w-8 text-primary" />
            <span className="font-headline text-lg font-semibold text-primary">DocJob</span>
            <Badge variant="secondary" className="ml-1 hidden text-[10px] sm:inline-flex">
              {t('nav.beta')}
            </Badge>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#capabilities" className="transition-colors hover:text-foreground">
              {t('nav.capabilities')}
            </a>
            <a href="#catalog" className="transition-colors hover:text-foreground">
              {t('nav.catalog')}
            </a>
            <a href="#news" className="transition-colors hover:text-foreground">
              {t('nav.news')}
            </a>
            <Link href="/download" className="transition-colors hover:text-foreground">
              {t('nav.download')}
            </Link>
            <a href="#contacts" className="transition-colors hover:text-foreground">
              {t('nav.contacts')}
            </a>
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                {t('nav.login')}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <HeroSection directions={directions} />

      <Separator className="opacity-30" />

      <AiSearchHeroSection />

      <Separator className="opacity-30" />

      <section id="capabilities" className="px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
              {t('capabilitiesSection.badge')}
            </Badge>
            <h2 className="font-headline text-3xl font-semibold tracking-tight md:text-4xl">
              {t('capabilitiesSection.title')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              {t('capabilitiesSection.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {capabilities.map((c) => {
              const Icon = c.icon;
              return (
                <Card
                  key={c.key}
                  className="border-border/60 bg-card/60 p-5 transition-colors hover:border-primary/40 sm:p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-base font-semibold">{c.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <Separator className="opacity-30" />

      <section id="catalog" className="px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <Badge variant="outline" className="mb-3 border-accent/40 bg-accent/10 text-accent">
              {t('catalogSection.badge')}
            </Badge>
            <h2 className="font-headline text-3xl font-semibold tracking-tight md:text-4xl">
              {t('catalogSection.title')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              {t('catalogSection.subtitle')}
            </p>
          </div>

          <Card className="mb-8 border-primary/40 bg-primary/5 p-5 sm:p-6 md:p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/15">
                <Brain className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-headline text-lg font-semibold md:text-xl">
                  {t('catalogSection.aiHighlight.title')}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                  {t('catalogSection.aiHighlight.description')}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {directions.map((d) => {
              const Icon = d.icon;
              return (
                <Card
                  key={d.key}
                  className="group flex aspect-square flex-col justify-between border-border/60 bg-card/60 p-3 transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 sm:p-6"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 sm:h-12 sm:w-12">
                    <Icon className="h-4 w-4 text-primary sm:h-6 sm:w-6" />
                  </div>
                  <div className="min-w-0 space-y-1 sm:space-y-2">
                    <h3 className="break-words text-[12px] font-semibold leading-tight transition-colors group-hover:text-primary sm:text-base">
                      {d.title}
                    </h3>
                    <p className="break-words text-[10px] leading-relaxed text-muted-foreground sm:text-xs">
                      {d.description}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <Separator className="opacity-30" />

      <NewsSection items={newsItems} />

      <Separator className="opacity-30" />

      <section className="px-4 py-16 sm:px-6 md:py-20">
        <Card className="mx-auto max-w-5xl overflow-hidden border-primary/40 bg-primary/5 p-5 sm:p-6 md:p-9">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
              <Smartphone className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1">
              <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
                {t('downloadCta.badge')}
              </Badge>
              <h2 className="font-headline text-2xl font-semibold tracking-tight md:text-3xl">
                {t('downloadCta.title')}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                {t('downloadCta.description')}
              </p>
            </div>
            <Button asChild size="lg" className="w-full shrink-0 md:w-auto">
              <Link href="/download">
                {t('downloadCta.action')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Card>
      </section>

      <Separator className="opacity-30" />

      <section className="px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
          <h2 className="font-headline text-3xl font-semibold md:text-4xl">{t('cta.title')}</h2>
          <p className="max-w-xl text-base text-muted-foreground md:text-lg">
            {t('cta.description')}
          </p>
          <div className="flex w-full justify-center">
            <Link href="/register" className="w-full max-w-sm sm:w-auto">
              <Button size="lg" className="h-auto min-h-12 w-full whitespace-normal px-6 py-3 text-base sm:w-auto sm:px-10">
                {t('cta.primary')}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Separator className="opacity-30" />

      <section id="contacts" className="px-4 py-16 sm:px-6 md:py-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 text-center">
            <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
              {t('contacts.badge')}
            </Badge>
            <h2 className="font-headline text-3xl font-semibold tracking-tight md:text-4xl">
              {t('contacts.title')}
            </h2>
          </div>

          <Card className="border-border/60 bg-card/60 p-5 sm:p-8">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('contacts.addressLabel')}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">{t('contacts.addressValue')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('contacts.emailLabel')}
                  </p>
                  <a
                    href="mailto:docjob@inbox.kz"
                    className="mt-1 block text-sm text-primary hover:underline"
                  >
                    docjob@inbox.kz
                  </a>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="mx-auto mt-12 max-w-6xl">
          <LandingContactForm />
        </div>
      </section>

      <footer className="mt-auto border-t border-border/40 px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <DocJobLogo className="h-6 w-6 text-primary" />
            <span className="font-medium">DocJob</span>
            <span className="text-muted-foreground/70">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#capabilities" className="transition-colors hover:text-foreground">
              {t('footer.capabilities')}
            </a>
            <a href="#catalog" className="transition-colors hover:text-foreground">
              {t('footer.catalog')}
            </a>
            <a href="#news" className="transition-colors hover:text-foreground">
              {t('footer.news')}
            </a>
            <Link href="/download" className="transition-colors hover:text-foreground">
              {t('footer.download')}
            </Link>
            <a href="#contacts" className="transition-colors hover:text-foreground">
              {t('footer.contacts')}
            </a>
            <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
              {t('footer.privacy')}
            </Link>
            <Link href="/legal/terms" className="transition-colors hover:text-foreground">
              {t('footer.terms')}
            </Link>
          </div>
        </div>
      </footer>

      <LandingStyles />
    </div>
  );
}

type Direction = {
  key: DirectionKey;
  icon: LucideIcon;
  title: string;
  description: string;
};

async function HeroSection({ directions }: { directions: Direction[] }) {
  const t = await getTranslations('landing.hero');
  const cyclingWords = (t.raw('cyclingWords') as string[]) ?? [];
  const headlinePrefix = t('headlinePrefix');
  const headlineSuffix = t('headlineSuffix');
  return (
    <section className="relative flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center overflow-hidden px-4 py-16 text-center sm:min-h-[88vh] sm:px-6 sm:py-24">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute rounded-full opacity-20 blur-3xl"
          style={{
            width: 700,
            height: 500,
            background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)',
            top: '5%',
            left: '50%',
            transform: 'translateX(-50%)',
            animation: 'landingBlob1 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute rounded-full opacity-10 blur-3xl"
          style={{
            width: 500,
            height: 400,
            background: 'radial-gradient(circle, hsl(var(--accent)), transparent 70%)',
            top: '30%',
            left: '15%',
            animation: 'landingBlob2 22s ease-in-out infinite',
          }}
        />
        <div
          className="absolute rounded-full opacity-10 blur-3xl"
          style={{
            width: 400,
            height: 350,
            background: 'radial-gradient(circle, hsl(var(--primary)), transparent 70%)',
            top: '20%',
            right: '10%',
            animation: 'landingBlob3 16s ease-in-out infinite',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--muted-foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <div className="relative flex w-full max-w-4xl flex-col items-center gap-7">
        <Badge
          variant="outline"
          className="border-primary/40 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-wide text-primary"
        >
          <HeartPulse className="mr-2 h-3.5 w-3.5" />
          {t('badge')}
        </Badge>

        <h1 className="max-w-full break-words font-headline text-2xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-3xl md:text-5xl lg:text-[3.25rem]">
          {headlinePrefix ? (
            <span className="block text-foreground/85">{headlinePrefix}</span>
          ) : null}
          <span className="block text-primary">
            <CyclingWord words={cyclingWords} />
          </span>
          <span className="block text-foreground/85">{headlineSuffix}</span>
        </h1>

        <p className="max-w-2xl break-words text-base leading-relaxed text-muted-foreground md:text-lg">
          {t('subtitle')}
        </p>

        <div className="flex w-full max-w-sm flex-col justify-center gap-3 sm:w-auto sm:max-w-none sm:flex-row">
          <Link href="/register" className="w-full sm:w-auto">
            <Button size="lg" className="h-auto min-h-12 w-full whitespace-normal px-6 py-3 text-base shadow-lg shadow-primary/20 sm:w-auto sm:px-10">
              {t('ctaPrimary')}
            </Button>
          </Link>
          <Button asChild size="lg" variant="outline" className="h-auto min-h-12 w-full whitespace-normal px-6 py-3 text-base sm:w-auto sm:px-8">
            <Link href="/download">
              <Smartphone className="h-4 w-4" />
              {t('ctaDownload')}
            </Link>
          </Button>
        </div>

        <div className="relative mt-6 w-full">
          <div className="mb-6 w-full overflow-hidden">
            <svg
              viewBox="0 0 400 60"
              className="h-12 w-full opacity-40"
              preserveAspectRatio="none"
            >
              <path
                d={ECG_PATH}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: 1200,
                  animation: 'landingEcg 3s linear infinite',
                }}
              />
              <circle r="3" fill="hsl(var(--accent))" opacity="0.95">
                <animateMotion dur="3s" repeatCount="indefinite" path={ECG_PATH} />
              </circle>
            </svg>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {directions.map((d, i) => {
              const Icon = d.icon;
              return (
                <div
                  key={d.key}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-3 text-left backdrop-blur-sm"
                  style={{
                    animation: `landingFloat ${6 + i * 0.4}s ease-in-out infinite`,
                    animationDelay: `${i * 0.4}s`,
                  }}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="min-w-0 break-words text-xs font-semibold leading-tight text-foreground">
                    {d.title}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

async function AiSearchHeroSection() {
  const t = await getTranslations('landing.aiSearchHero');
  return (
    <section className="relative overflow-hidden px-4 py-16 sm:px-6 md:py-20">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
          style={{
            background: 'radial-gradient(circle, hsl(var(--accent)), transparent 70%)',
            animation: 'landingBlob2 14s ease-in-out infinite',
          }}
        />
      </div>

      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-7 text-center">
        <div className="relative">
          <span
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: '0 0 0 0 hsl(var(--primary) / 0.45)',
              animation: 'aiSearchPulse 2.4s ease-out infinite',
            }}
          />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
            <Search className="h-9 w-9 text-primary" />
          </div>
        </div>

        <Badge
          variant="outline"
          className="border-primary/40 bg-primary/10 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-primary"
          style={{ animation: 'aiSearchFade 0.8s ease-out 0.1s both' }}
        >
          {t('badge')}
        </Badge>

        <h2
          className="max-w-full break-words font-headline text-3xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] md:text-5xl"
        >
          <span
            className="block text-foreground/85"
            style={{ animation: 'aiSearchSlideUp 0.8s ease-out 0.3s both' }}
          >
            {t('line1')}
          </span>
          <span
            className="block text-primary"
            style={{ animation: 'aiSearchSlideUp 0.8s ease-out 0.55s both' }}
          >
            {t('line2')}
          </span>
        </h2>

        <p
          className="max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
          style={{ animation: 'aiSearchFade 0.8s ease-out 0.8s both' }}
        >
          {t('hint')}
        </p>

        <div
          className="flex w-full justify-center"
          style={{ animation: 'aiSearchFade 0.8s ease-out 1s both' }}
        >
          <Link href="/register" className="w-full max-w-sm sm:w-auto">
            <Button size="lg" className="h-auto min-h-12 w-full whitespace-normal px-6 py-3 text-base sm:w-auto sm:px-10">
              <Sparkles className="mr-2 h-4 w-4" />
              {t('cta')}
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

async function NewsSection({ items }: { items: LandingNewsItem[] }) {
  const t = await getTranslations('landing.newsSection');
  const locale = await getLocale();

  return (
    <section id="news" className="px-4 py-16 sm:px-6 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <Badge variant="outline" className="mb-3 border-primary/40 bg-primary/10 text-primary">
              <Newspaper className="mr-2 h-3.5 w-3.5" />
              {t('badge')}
            </Badge>
            <h2 className="font-headline text-3xl font-semibold tracking-tight md:text-4xl">
              {t('title')}
            </h2>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">{t('subtitle')}</p>
          </div>

          <Link href="/news">
            <Button variant="outline" className="shrink-0">
              <Newspaper className="mr-2 h-4 w-4" />
              {t('readAll')}
            </Button>
          </Link>
        </div>

        {items.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-3">
            {items.map((item) => (
              <Card
                key={item.id}
                className="flex min-h-56 flex-col border-border/60 bg-card/60 p-6 transition-colors hover:border-primary/40"
              >
                <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  <span>{formatLandingNewsDate(item.date, locale)}</span>
                </div>
                <h3 className="text-lg font-semibold leading-snug">{item.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {makeNewsExcerpt(item.body)}
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-border/60 bg-card/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </Card>
        )}
      </div>
    </section>
  );
}

function formatLandingNewsDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function makeNewsExcerpt(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 180).trim()}...`;
}

async function getLandingNewsItems(): Promise<LandingNewsItem[]> {
  try {
    return (await getPublicNewsItems()).slice(0, 3);
  } catch (error) {
    console.error('getLandingNewsItems failed', error);
    return [];
  }
}

function LandingStyles() {
  return (
    <style>{`
      @keyframes landingBlob1 {
        0%, 100% { transform: translateX(-50%) translateY(0) scale(1); }
        33%       { transform: translateX(-45%) translateY(-30px) scale(1.05); }
        66%       { transform: translateX(-55%) translateY(20px) scale(0.97); }
      }
      @keyframes landingBlob2 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        40%       { transform: translate(40px, -50px) scale(1.08); }
        70%       { transform: translate(-20px, 30px) scale(0.95); }
      }
      @keyframes landingBlob3 {
        0%, 100% { transform: translate(0, 0) scale(1); }
        35%       { transform: translate(-30px, 40px) scale(1.06); }
        65%       { transform: translate(20px, -20px) scale(0.96); }
      }
      @keyframes landingFloat {
        0%, 100% { transform: translateY(0px);  }
        50%       { transform: translateY(-7px); }
      }
      @keyframes landingEcg {
        0%   { stroke-dashoffset: 1200; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes aiSearchPulse {
        0%   { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.45); }
        70%  { box-shadow: 0 0 0 30px hsl(var(--primary) / 0); }
        100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0); }
      }
      @keyframes aiSearchSlideUp {
        0%   { opacity: 0; transform: translateY(14px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      @keyframes aiSearchFade {
        0%   { opacity: 0; }
        100% { opacity: 1; }
      }
    `}</style>
  );
}
