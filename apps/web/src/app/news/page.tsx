import type { Metadata } from 'next';
import { CalendarDays } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { LegalPageShell } from '@/app/legal/_components/legal-page-shell';
import { getPublicNewsItems } from '@/lib/news';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Новости DocJob — медицинская платформа клинических кейсов',
  description:
    'Свежие новости проекта DocJob: обновления платформы медицинских кейсов, новые клинические случаи и возможности AI-поиска для врачей.',
  alternates: { canonical: '/news' },
};

function formatNewsDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function NewsPage() {
  const t = await getTranslations('landing.newsSection');
  const locale = await getLocale();
  const items = await getPublicNewsItems();

  return (
    <LegalPageShell title={t('title')} subtitle={t('subtitle')}>
      {items.length > 0 ? (
        <div className="space-y-5">
          {items.map((item) => (
            <Card key={item.id} className="border-border/60 bg-card/60 p-6">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
                <span>{formatNewsDate(item.date, locale)}</span>
              </div>
              <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                {item.body}
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/60 bg-card/60 p-8 text-center">
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </Card>
      )}
    </LegalPageShell>
  );
}
