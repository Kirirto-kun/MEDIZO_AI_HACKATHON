'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, PenSquare, Trash2 } from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import ScenarioControls from '@/components/scenario-controls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useUserStore } from '@/hooks/use-user-store';
import { trpc } from '@/lib/trpc/react';
import { subgroupLabel } from '@/lib/case-taxonomy';

export default function MyReviewsPage() {
  const router = useRouter();
  const { currentUser, isInitialized } = useUserStore();
  const t = useTranslations('myReviews');
  const { toast } = useToast();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!isInitialized) return;
    if (!currentUser) {
      router.push('/login');
    }
  }, [isInitialized, currentUser, router]);

  const reviewsQuery = trpc.reviews.mine.useQuery(undefined, {
    enabled: isInitialized && !!currentUser,
  });
  const reviews = reviewsQuery.data ?? [];
  const loading = reviewsQuery.isLoading;

  const deleteMutation = trpc.reviews.delete.useMutation();

  const handleDelete = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;
    try {
      await deleteMutation.mutateAsync(id);
    } catch (e) {
      toast({ variant: 'destructive', title: e instanceof Error ? e.message : t('deleteReview') });
      return;
    }
    await utils.reviews.mine.invalidate();
  };

  return (
    <DashboardLayout sidebarContent={<ScenarioControls onScenarioGenerated={() => {}} />}>
      <main className="h-full overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          <div>
            <h1 className="font-headline text-3xl font-semibold">{t('title')}</h1>
            <p className="mt-1 text-muted-foreground">{t('description')}</p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : reviews.length === 0 ? (
            <Card className="p-12 text-center">
              <PenSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">{t('empty')}</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {reviews.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-lg">{r.case.name}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                          {r.case.subgroup ? (
                            <Badge variant="secondary">{subgroupLabel(r.case.subgroup)}</Badge>
                          ) : null}
                          <span>
                            {new Date(r.createdAt).toLocaleDateString()}
                          </span>
                        </CardDescription>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t('deleteReview')}
                        onClick={() => void handleDelete(r.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{r.body}</p>
                    <Link
                      href={`/cases/${r.case.subgroup ?? 'clinical'}/${r.case.id}`}
                      className="inline-flex text-sm text-primary hover:underline"
                    >
                      {t('openCase')}
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
