'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Paperclip,
  Plus,
  Send,
  Trash2,
  FilePlus2,
  ChevronLeft,
  Inbox,
} from 'lucide-react';
import DashboardLayout from '@/components/dashboard-layout';
import ScenarioControls from '@/components/scenario-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUserStore } from '@/hooks/use-user-store';
import { trpc } from '@/lib/trpc/react';
import type { SerializedCaseSubmission, SerializedSubmissionAttachment } from '@docjob/core';
import { authFetch } from '@/lib/auth-client';
import { SUBGROUPS, subgroupLabel } from '@/lib/case-taxonomy';
import { cn } from '@/lib/utils';

type Mode = 'list' | 'new' | 'thread';

const STATUS_KEYS: Record<string, string> = {
  new: 'new',
  in_review: 'in_review',
  accepted: 'accepted',
  rejected: 'rejected',
  done: 'done',
};

export default function SuggestCasePage() {
  const router = useRouter();
  const { currentUser, isInitialized } = useUserStore();
  const t = useTranslations('suggestCase');
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('list');
  const [activeId, setActiveId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!isInitialized) return;
    if (!currentUser) {
      router.push('/login');
    }
  }, [isInitialized, currentUser, router]);

  const submissionsQuery = trpc.submissions.mine.useQuery(undefined, {
    enabled: isInitialized && !!currentUser,
  });
  const submissions = submissionsQuery.data ?? [];
  const loading = submissionsQuery.isLoading;

  const refresh = async () => {
    await utils.submissions.mine.invalidate();
  };

  const activeSubmission = submissions.find((s) => s.id === activeId) ?? null;

  return (
    <DashboardLayout sidebarContent={<ScenarioControls onScenarioGenerated={() => {}} />}>
      <main className="h-full overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          <div>
            <h1 className="font-headline text-3xl font-semibold">{t('title')}</h1>
            <p className="mt-1 text-muted-foreground">{t('description')}</p>
          </div>

          {mode === 'list' && (
            <ListView
              loading={loading}
              submissions={submissions}
              onNew={() => setMode('new')}
              onOpen={(id) => {
                setActiveId(id);
                setMode('thread');
              }}
            />
          )}

          {mode === 'new' && (
            <NewSubmissionForm
              onCancel={() => setMode('list')}
              onCreated={async (id) => {
                await refresh();
                setActiveId(id);
                setMode('thread');
              }}
              onError={(err) => toast({ variant: 'destructive', title: err })}
            />
          )}

          {mode === 'thread' && activeSubmission && (
            <ThreadView
              submission={activeSubmission}
              onBack={() => setMode('list')}
              onSent={refresh}
              onError={(err) => toast({ variant: 'destructive', title: err })}
            />
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}

function ListView({
  loading,
  submissions,
  onNew,
  onOpen,
}: {
  loading: boolean;
  submissions: SerializedCaseSubmission[];
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('suggestCase');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{t('list.title')}</CardTitle>
            <Button onClick={onNew}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              {t('form.submit')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : submissions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
              <Inbox className="h-10 w-10" />
              <p className="text-sm">{t('list.empty')}</p>
            </div>
          ) : (
            <ul className="divide-y">
              {submissions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onOpen(s.id)}
                    className="flex w-full flex-col gap-2 py-3 text-left transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.title}</p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {s.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {s.subgroup ? (
                        <Badge variant="secondary">{subgroupLabel(s.subgroup)}</Badge>
                      ) : null}
                      <Badge variant="outline">
                        {t(`list.status.${STATUS_KEYS[s.status] ?? 'new'}`)}
                      </Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewSubmissionForm({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('suggestCase');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [authors, setAuthors] = useState<string[]>(['']);
  const [subgroup, setSubgroup] = useState<string>('none');
  const [attachments, setAttachments] = useState<SerializedSubmissionAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createMutation = trpc.submissions.create.useMutation();
  const submitting = createMutation.isPending;

  const onAddAuthor = () => setAuthors((prev) => [...prev, '']);
  const onRemoveAuthor = (i: number) =>
    setAuthors((prev) => prev.filter((_, idx) => idx !== i));
  const onAuthorChange = (i: number, val: string) =>
    setAuthors((prev) => prev.map((a, idx) => (idx === i ? val : a)));

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await authFetch('/api/attachments/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          onError(`${file.name}: ${res.status}`);
          continue;
        }
        const data = await res.json();
        setAttachments((prev) => [
          ...prev,
          {
            attachmentId: data.id,
            filename: data.filename,
            originalName: file.name,
            url: data.url,
            mimeType: data.mimeType,
            size: data.size,
          },
        ]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onSubmit = async () => {
    try {
      const data = await createMutation.mutateAsync({
        title,
        description,
        authors: authors.map((a) => a.trim()).filter(Boolean),
        subgroup: subgroup === 'none' ? null : subgroup,
        attachmentIds: attachments.map((a) => a.attachmentId),
      });
      onCreated(data.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : t('form.submit'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="title">{t('form.titleLabel')}</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('form.titlePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">{t('form.descriptionLabel')}</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder={t('form.descriptionPlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('form.authorsLabel')}</Label>
          <p className="text-xs text-muted-foreground">{t('form.authorsHint')}</p>
          <div className="space-y-2">
            {authors.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={a}
                  onChange={(e) => onAuthorChange(i, e.target.value)}
                  placeholder={t('form.authorPlaceholder')}
                />
                {authors.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveAuthor(i)}
                    aria-label={t('form.removeAuthor')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onAddAuthor}>
            <Plus className="mr-2 h-4 w-4" />
            {t('form.addAuthor')}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subgroup">{t('form.subgroupLabel')}</Label>
          <Select value={subgroup} onValueChange={setSubgroup}>
            <SelectTrigger id="subgroup">
              <SelectValue placeholder={t('form.subgroupPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {SUBGROUPS.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t('form.attachmentsLabel')}</Label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
          <Button type="button" variant="outline" onClick={onPickFile} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="mr-2 h-4 w-4" />
            )}
            {t('thread.attach')}
          </Button>
          {attachments.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {attachments.map((a) => (
                <li key={a.attachmentId} className="flex items-center gap-2">
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-primary hover:underline"
                  >
                    {a.originalName ?? a.filename}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('thread.back')}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={submitting || title.trim().length < 3 || description.trim().length < 10}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('form.submit')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ThreadView({
  submission,
  onBack,
  onSent,
  onError,
}: {
  submission: SerializedCaseSubmission;
  onBack: () => void;
  onSent: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('suggestCase');
  const { currentUser } = useUserStore();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<SerializedSubmissionAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendMutation = trpc.submissions.sendMessage.useMutation();
  const sending = sendMutation.isPending;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [submission.messages.length]);

  const onSend = async () => {
    if (sending) return;
    if (draft.trim().length === 0 && attachments.length === 0) return;
    try {
      await sendMutation.mutateAsync({
        submissionId: submission.id,
        body: draft.trim() || '[вложение]',
        attachmentIds: attachments.map((a) => a.attachmentId),
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : t('thread.send'));
      return;
    }
    setDraft('');
    setAttachments([]);
    await onSent();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/attachments/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        onError(`${file.name}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      setAttachments((prev) => [
        ...prev,
        {
          attachmentId: data.id,
          filename: data.filename,
          originalName: file.name,
          url: data.url,
          mimeType: data.mimeType,
          size: data.size,
        },
      ]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Card className="flex h-[78vh] flex-col overflow-hidden">
      <CardHeader className="border-b pb-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            {t('thread.back')}
          </Button>
        </div>
        <CardTitle className="mt-2 text-lg">{submission.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          {submission.subgroup ? (
            <Badge variant="secondary">{subgroupLabel(submission.subgroup)}</Badge>
          ) : null}
          <Badge variant="outline">
            {t(`list.status.${STATUS_KEYS[submission.status] ?? 'new'}`)}
          </Badge>
          {submission.authors.length > 0 ? (
            <span className="text-muted-foreground">
              {submission.authors.join(', ')}
            </span>
          ) : null}
        </CardDescription>
      </CardHeader>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
        {submission.messages.map((m) => {
          const isMe = currentUser?.id === m.senderId;
          return (
            <div
              key={m.id}
              className={cn('flex gap-2', isMe ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                  isMe ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground',
                )}
              >
                <p className="text-[10px] font-medium uppercase opacity-70">
                  {isMe ? t('thread.you') : m.senderName}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{m.body}</p>
                {m.attachments.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {m.attachments.map((a) => (
                      <li key={a.attachmentId} className="text-xs">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                        >
                          <Paperclip className="h-3 w-3" />
                          {a.originalName ?? a.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-1 text-[10px] opacity-60">
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <CardContent className="border-t bg-card/60 p-3">
        {attachments.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2 text-xs">
            {attachments.map((a) => (
              <li
                key={a.attachmentId}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1"
              >
                <Paperclip className="h-3 w-3" />
                {a.originalName ?? a.filename}
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex items-end gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('thread.attach')}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('thread.placeholder')}
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <Button onClick={onSend} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">{t('thread.send')}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
