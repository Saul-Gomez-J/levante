/**
 * FileContentRenderer
 *
 * Chooses the right renderer for file tabs.
 */

import { Loader2 } from 'lucide-react';
import type { FileTab } from '@/stores/sidePanelStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeViewer } from './CodeViewer';
import { BinaryFileState } from './BinaryFileState';

interface FileContentRendererProps {
  tab: FileTab;
}

export function FileContentRenderer({ tab }: FileContentRendererProps) {
  if (tab.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tab.isBinary) {
    return <BinaryFileState fileName={tab.fileName} />;
  }

  if (!tab.content) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No content
      </div>
    );
  }

  if (tab.language === 'markdown') {
    return <MarkdownRenderer content={tab.content} />;
  }

  return <CodeViewer content={tab.content} language={tab.language} />;
}
