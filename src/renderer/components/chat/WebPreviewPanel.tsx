/**
 * WebPreviewPanel
 *
 * Panel lateral colapsable que muestra una previsualización web
 * de los servidores detectados en background tasks.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { X, RefreshCw, ExternalLink, Monitor, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebPreviewStore, type DetectedServer } from '@/stores/webPreviewStore';
import { Badge } from '@/components/ui/badge';
import { useSidebar } from '@/components/ui/sidebar';

const MIN_PANEL_WIDTH = 320;
const MIN_CHAT_WIDTH = 300;
const DEFAULT_PANEL_WIDTH = 640;

function ServerTab({
  server,
  isActive,
  onClick,
}: {
  server: DetectedServer;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors shrink-0',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      title={server.command}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          server.isAlive ? 'bg-green-400' : 'bg-red-400'
        )}
      />
      <span>:{server.port}</span>
      {!server.isAlive && (
        <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5">
          stopped
        </Badge>
      )}
    </button>
  );
}

export function WebPreviewPanel() {
  const { servers, isPanelOpen, activeTaskId, closePanel, setActiveServer } =
    useWebPreviewStore();

  const { setOpen: setSidebarOpen } = useSidebar();

  useEffect(() => {
    if (isPanelOpen) {
      setSidebarOpen(false);
    }
  }, [isPanelOpen, setSidebarOpen]);

  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [iframeKey, setIframeKey] = useState(0); // para forzar reload
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const maxWidthRef = useRef(DEFAULT_PANEL_WIDTH * 2);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeServer = servers.find((s) => s.taskId === activeTaskId) ?? servers[0];

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startWidth.current = width;
    maxWidthRef.current = containerRef.current?.parentElement
      ? containerRef.current.parentElement.clientWidth - MIN_CHAT_WIDTH
      : DEFAULT_PANEL_WIDTH * 2;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(
        maxWidthRef.current,
        Math.max(MIN_PANEL_WIDTH, startWidth.current + delta)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  const handleOpenExternal = () => {
    if (activeServer) {
      window.levante.openExternal(activeServer.url);
    }
  };

  if (!isPanelOpen || servers.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="flex shrink-0 h-full"
      style={{ width }}
    >
      {/* Handle de resize */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors shrink-0 h-full"
        onMouseDown={handleMouseDown}
      />

      {/* Panel principal */}
      <div className="flex-1 flex flex-col border-l bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0 bg-muted/30">
          <Monitor size={13} className="text-muted-foreground shrink-0" />

          {/* Tabs de servidores */}
          <div className="flex-1 flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-none">
            {servers.map((server) => (
              <ServerTab
                key={server.taskId}
                server={server}
                isActive={server.taskId === activeTaskId}
                onClick={() => setActiveServer(server.taskId)}
              />
            ))}
          </div>

          {/* Controles */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReload}
              title="Reload preview"
              disabled={!activeServer?.isAlive}
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleOpenExternal}
              title="Open in browser"
              disabled={!activeServer}
            >
              <ExternalLink size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={closePanel}
              title="Close preview"
            >
              <X size={12} />
            </Button>
          </div>
        </div>

        {/* URL bar */}
        {activeServer && (
          <div className="flex items-center gap-2 px-2 py-1 border-b bg-muted/20 shrink-0">
            <Server size={11} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-muted-foreground truncate">
              {activeServer.url}
            </span>
            {!activeServer.isAlive && (
              <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-4 shrink-0">
                offline
              </Badge>
            )}
          </div>
        )}

        {/* Contenido */}
        <div className="flex-1 relative overflow-hidden">
          {isDragging && (
            <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
          {!activeServer ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No server selected
            </div>
          ) : !activeServer.isAlive ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Server size={32} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">Server stopped</p>
                <p className="text-xs mt-1 opacity-70">
                  The process running on :{activeServer.port} has ended
                </p>
              </div>
            </div>
          ) : (
            <iframe
              key={iframeKey}
              src={activeServer.url}
              title={`Preview :${activeServer.port}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
              allow="fullscreen; clipboard-read; clipboard-write"
              className="absolute inset-0 w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
