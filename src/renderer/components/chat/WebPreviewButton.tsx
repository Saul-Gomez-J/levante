/**
 * WebPreviewButton
 *
 * Botón para la barra de herramientas del chat.
 * Muestra un badge animado cuando hay servidores detectados.
 * Abre/cierra el WebPreviewPanel.
 */

import { Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWebPreviewStore } from '@/stores/webPreviewStore';

interface WebPreviewButtonProps {
  className?: string;
}

export function WebPreviewButton({ className }: WebPreviewButtonProps) {
  const servers = useWebPreviewStore((s) => s.servers);
  const isPanelOpen = useWebPreviewStore((s) => s.isPanelOpen);
  const openPanel = useWebPreviewStore((s) => s.openPanel);
  const closePanel = useWebPreviewStore((s) => s.closePanel);

  const aliveServers = servers.filter((s) => s.isAlive);

  // No renderizar si no hay ningún servidor detectado nunca
  if (servers.length === 0) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'relative rounded-lg h-8 w-8',
        isPanelOpen
          ? 'text-primary bg-primary/10'
          : 'text-muted-foreground',
        className
      )}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      title={
        isPanelOpen
          ? 'Close web preview'
          : `Web preview (${aliveServers.length} server${aliveServers.length !== 1 ? 's' : ''})`
      }
      type="button"
    >
      <Monitor size={16} />
      {aliveServers.length > 0 && !isPanelOpen && (
        <Badge
          variant="default"
          className="absolute -top-1 -right-1 h-4 min-w-4 px-1 flex items-center justify-center text-[10px] bg-green-500 border-0"
        >
          {aliveServers.length}
        </Badge>
      )}
      {/* Indicador animado cuando hay servidor pero panel cerrado */}
      {aliveServers.length > 0 && !isPanelOpen && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        </span>
      )}
    </Button>
  );
}
