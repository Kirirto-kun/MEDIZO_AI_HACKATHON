'use client';

import { Download, ExternalLink, File as FileIcon, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CaseBodyViewer } from '@/components/case-body-viewer';
import { subgroupLabel } from '@/lib/case-taxonomy';
import { cn } from '@/lib/utils';
import type { SerializedCase, SerializedCaseAttachment } from '@/app/actions';

const KB = 1024;
const MB = KB * 1024;

function formatFileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} МБ`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} КБ`;
  return `${bytes} Б`;
}

function useGenderLabel() {
  const t = useTranslations('case.info');
  return (gender: string | null): string | null => {
    if (!gender) return null;
    const value = gender.trim().toLowerCase();
    if (value === 'м' || value === 'male' || value === 'm') return t('genderMale');
    if (value === 'ж' || value === 'female' || value === 'f') return t('genderFemale');
    return gender;
  };
}

type CaseInfoPanelProps = {
  caseData: SerializedCase;
};

export function CaseInfoPanel({ caseData }: CaseInfoPanelProps) {
  const t = useTranslations('case.info');
  const genderLabel = useGenderLabel();
  const headerMeta = [
    caseData.age != null ? `${caseData.age} ${t('headerYears')}` : null,
    genderLabel(caseData.gender),
  ].filter(Boolean);

  const sortedAttachments = [...caseData.attachments].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );

  return (
    <div className="space-y-8 pb-6">
      <header className="space-y-3">
        <h1 className="font-headline text-2xl font-semibold leading-tight md:text-3xl">
          {caseData.name}
        </h1>
        {headerMeta.length > 0 ? (
          <p className="text-sm text-muted-foreground">{headerMeta.join(' · ')}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {caseData.specialty ? (
            <Badge variant="secondary" className="text-[11px]">
              {caseData.specialty}
            </Badge>
          ) : null}
          {caseData.subgroup ? (
            <Badge variant="outline" className="text-[11px]">
              {subgroupLabel(caseData.subgroup)}
            </Badge>
          ) : null}
          {caseData.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[11px]">
              {tag}
            </Badge>
          ))}
        </div>
      </header>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sectionBody')}
        </h2>
        <CaseBodyViewer body={caseData.body} />
      </section>

      {sortedAttachments.length > 0 ? (
        <>
          <Separator />
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('sectionAttachments')}
            </h2>
            <div className="space-y-5">
              {sortedAttachments.map((a) => (
                <AttachmentItem key={a.id} attachment={a} />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function AttachmentItem({ attachment }: { attachment: SerializedCaseAttachment }) {
  const t = useTranslations('case.info');
  const displayName = attachment.title?.trim() || attachment.originalName || attachment.filename;
  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/15 p-4">
      <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words font-medium leading-snug [overflow-wrap:anywhere]">{displayName}</p>
          {attachment.description ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {attachment.description}
            </p>
          ) : null}
          <p className="break-all text-xs text-muted-foreground">
            {(attachment.originalName ?? attachment.filename) +
              ' · ' +
              formatFileSize(attachment.size)}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="w-full shrink-0 sm:w-auto">
          <a href={attachment.url} target="_blank" rel="noreferrer">
            <Download className="mr-1 h-4 w-4" />
            {t('downloadAction')}
          </a>
        </Button>
      </div>
      <AttachmentBody attachment={attachment} />
    </div>
  );
}

function AttachmentBody({ attachment }: { attachment: SerializedCaseAttachment }) {
  const t = useTranslations('case.info');
  if (attachment.kind === 'image') {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="group block overflow-hidden rounded-md border border-border/40 bg-background"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.title ?? attachment.originalName ?? attachment.filename}
          className="max-h-[600px] w-full object-contain transition group-hover:opacity-95"
        />
      </a>
    );
  }
  if (attachment.kind === 'pdf') {
    return (
      <div className="overflow-hidden rounded-md border border-border/40">
        <iframe
          src={attachment.url}
          title={attachment.title ?? attachment.originalName ?? attachment.filename}
          className="h-[640px] w-full bg-white"
        />
      </div>
    );
  }
  const Icon = attachment.kind === 'document' ? FileText : FileIcon;
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-3 rounded-md border border-border/40 bg-background/40 px-3 py-2 transition',
        'hover:border-primary',
      )}
    >
      <Icon className="h-6 w-6 text-muted-foreground" />
      <span className="flex-1 text-sm">{t('openFileAction')}</span>
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
    </a>
  );
}

export default CaseInfoPanel;
