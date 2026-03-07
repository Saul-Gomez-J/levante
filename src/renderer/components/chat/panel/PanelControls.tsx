/**
 * PanelControls
 *
 * Contextual actions for active tab.
 */

import { RefreshCw, ExternalLink, X, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PanelTab } from '@/stores/sidePanelStore';

interface PanelControlsProps {
  tab: PanelTab | undefined;
  onReload?: () => void;
  onOpenExternal?: () => void;
  onClose: () => void;
}

export function PanelControls({ tab, onReload, onOpenExternal, onClose }: PanelControlsProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {tab?.type === 'server' && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onReload}
            title="Reload preview"
            disabled={!tab.isAlive}
          >
            <RefreshCw size={12} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onOpenExternal}
            title="Open in browser"
            disabled={!tab.isAlive}
          >
            <ExternalLink size={12} />
          </Button>
        </>
      )}

      {tab?.type === 'file' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            void navigator.clipboard.writeText(tab.filePath);
          }}
          title="Copy file path"
        >
          <Copy size={12} />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onClose}
        title="Close panel"
      >
        <X size={12} />
      </Button>
    </div>
  );
}
