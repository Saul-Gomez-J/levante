import { Loader2 } from 'lucide-react';
import type { DocTab } from '@/stores/sidePanelStore';

interface HtmlViewerProps {
  tab: DocTab;
}

export function HtmlViewer({ tab }: HtmlViewerProps) {
  if (tab.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tab.loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4">
        <p className="text-sm font-medium">Failed to load HTML preview</p>
        <p className="text-xs opacity-70 text-center">{tab.loadError}</p>
        <p className="text-xs opacity-70 text-center">
          This preview only supports self-contained HTML files.
        </p>
      </div>
    );
  }

  if (!tab.htmlContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4">
        <p className="text-sm font-medium">No HTML content available</p>
      </div>
    );
  }

  return (
    <iframe
      key={tab.id}
      srcDoc={tab.htmlContent}
      title={tab.fileName}
      sandbox="allow-scripts allow-downloads"
      className="w-full h-full border-0 bg-white"
    />
  );
}
