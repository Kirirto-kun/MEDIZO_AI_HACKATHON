'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useUserStore } from '@/hooks/use-user-store';
import { trpc } from '@/lib/trpc/react';

type CaseReviewsPanelProps = {
  caseId: string;
};

export function CaseReviewsPanel({ caseId }: CaseReviewsPanelProps) {
  const t = useTranslations('caseReviews');
  const { currentUser } = useUserStore();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState('');

  const canWrite = currentUser?.role === 'reviewer' || currentUser?.role === 'admin';

  const reviewsQuery = trpc.reviews.forCase.useQuery(caseId);
  const reviews = reviewsQuery.data ?? [];
  const loading = reviewsQuery.isLoading;

  const createMutation = trpc.reviews.create.useMutation();
  const deleteMutation = trpc.reviews.delete.useMutation();

  const onSubmit = async () => {
    if (draft.trim().length < 10) return;
    try {
      await createMutation.mutateAsync({ caseId, body: draft.trim() });
    } catch (e) {
      toast({ variant: 'destructive', title: e instanceof Error ? e.message : t('addButton') });
      return;
    }
    setDraft('');
    await utils.reviews.forCase.invalidate(caseId);
    await utils.reviews.mine.invalidate();
  };

  const onDelete = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (e) {
      toast({ variant: 'destructive', title: e instanceof Error ? e.message : t('deleteButton') });
      return;
    }
    await utils.reviews.forCase.invalidate(caseId);
    await utils.reviews.mine.invalidate();
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </h2>
      </div>

      {canWrite ? (
        <div className="space-y-2 rounded-lg border border-border/50 bg-muted/15 p-4">
          <p className="text-sm font-medium">{t('addTitle')}</p>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('addPlaceholder')}
            rows={4}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              onClick={onSubmit}
              disabled={createMutation.isPending || draft.trim().length < 10}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('addButton')}
            </Button>
          </div>
        </div>
      ) : currentUser ? (
        <p className="text-xs text-muted-foreground">{t('onlyReviewers')}</p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const isMine = currentUser?.id === r.reviewerId;
            const isAdmin = currentUser?.role === 'admin';
            const meta = [
              r.reviewerSpecialty,
              r.reviewerAcademicDegree,
              r.reviewerWorkplace,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={r.id}
                className="space-y-2 rounded-lg border border-border/50 bg-card/50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{r.reviewerName}</p>
                    {meta ? (
                      <p className="text-xs text-muted-foreground">{meta}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                    {(isMine || isAdmin) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void onDelete(r.id)}
                        aria-label={t('deleteButton')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{r.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
