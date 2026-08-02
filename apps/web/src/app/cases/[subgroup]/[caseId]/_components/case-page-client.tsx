'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CaseReviewsPanel } from '@/components/case-reviews-panel';
import { SaveCaseButton } from '@/components/save-case-button';
import type { SerializedCase } from '@/app/actions';
import { CaseInfoPanel } from './case-info-panel';

type CasePageClientProps = {
  subgroup: string;
  caseData: SerializedCase;
};

export function CasePageClient({ subgroup, caseData }: CasePageClientProps) {
  const t = useTranslations('case.page');
  return (
    <main className="flex min-h-screen min-h-svh w-full min-w-0 max-w-full flex-col overflow-x-clip bg-background">
      <div className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-border/40 bg-background/80 px-4 py-2 backdrop-blur md:px-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/cases/${subgroup}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('back')}
          </Link>
        </Button>
        <span className="truncate text-sm text-muted-foreground">{caseData.name}</span>
        <div className="ml-auto">
          <SaveCaseButton caseId={caseData.id} variant="icon" />
        </div>
      </div>

      <div className="mx-auto w-full min-w-0 max-w-4xl flex-1 px-4 py-6 md:px-6 lg:px-8">
        <div className="space-y-8">
          <CaseInfoPanel caseData={caseData} />
          <Separator />
          <CaseReviewsPanel caseId={caseData.id} />
        </div>
      </div>
    </main>
  );
}

export default CasePageClient;
