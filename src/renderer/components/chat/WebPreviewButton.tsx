/**
 * WebPreviewButton
 *
 * Toolbar button for toggling the unified side panel.
 */

import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useSidePanelStore } from '@/stores/sidePanelStore';

interface WebPreviewButtonProps {
  className?: string;
}

export function WebPreviewButton({ className }: WebPreviewButtonProps) {
  const tabs = useSidePanelStore((state) => state.tabs);
  const isPanelOpen = useSidePanelStore((state) => state.isPanelOpen);
  const openPanel = useSidePanelStore((state) => state.openPanel);
  const closePanel = useSidePanelStore((state) => state.closePanel);

  const serverTabs = tabs.filter((tab) => tab.type === 'server');
  const fileTabs = tabs.filter((tab) => tab.type === 'file');
  const aliveServers = serverTabs.filter((tab) => tab.isAlive);

  // Hide only when there are no tabs at all
  if (tabs.length === 0) {
    return null;
  }

  const title = isPanelOpen
    ? 'Close side panel'
    : serverTabs.length > 0
      ? `Web preview (${aliveServers.length} server${aliveServers.length !== 1 ? 's' : ''})`
      : `Open side panel (${fileTabs.length} file tab${fileTabs.length !== 1 ? 's' : ''})`;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative rounded-lg h-8 w-8',
        isPanelOpen ? 'text-primary bg-primary/10' : 'text-muted-foreground',
        className
      )}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      title={title}
      type="button"
    >
      <Monitor size={16} />

      {aliveServers.length > 0 && !isPanelOpen && (
        <>
          <Badge
            variant="default"
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] bg-green-500 border-0"
          >
            {aliveServers.length}
          </Badge>

          <span className="absolute -top-0.5 -right-0.5 w-2 h-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          </span>
        </>
      )}
    </Button>
  );
}
