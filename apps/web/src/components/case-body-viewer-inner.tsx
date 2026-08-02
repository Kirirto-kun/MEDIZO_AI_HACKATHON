'use client';

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { useMemo } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { ru } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';

import type { CaseBody } from '@/lib/case-schema';
import { cn } from '@/lib/utils';

export type CaseBodyViewerInnerProps = {
  body: CaseBody;
  className?: string;
};

function toInitialContent(body: CaseBody): PartialBlock[] | undefined {
  const blocks = body?.blocks;
  return Array.isArray(blocks) && blocks.length > 0 ? (blocks as PartialBlock[]) : undefined;
}

export function CaseBodyViewerInner({ body, className }: CaseBodyViewerInnerProps) {
  const initialContent = useMemo(() => toInitialContent(body), [body]);

  const editor = useCreateBlockNote({
    initialContent,
    dictionary: ru,
  });

  if (!initialContent) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-6 text-sm text-muted-foreground',
          className,
        )}
      >
        Тело кейса пока не заполнено.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'case-body-prose min-w-0 max-w-full overflow-x-auto rounded-lg border border-border/30 px-4 py-4 shadow-sm sm:px-7 sm:py-6',
        className,
      )}
    >
      <BlockNoteView editor={editor} theme="light" editable={false} />
    </div>
  );
}

export default CaseBodyViewerInner;
