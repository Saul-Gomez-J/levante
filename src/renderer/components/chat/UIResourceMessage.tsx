/**
 * UIResourceMessage - Renders MCP UI Resources using @mcp-ui/client
 * Also provides Skybridge/OpenAI bridge compatibility for widgets that use window.openai API
 */

import React, { useState, useCallback, Suspense, useMemo, useEffect, useRef } from 'react';
import {
  UIResourceRenderer,
  basicComponentLibrary,
  type UIActionResult,
} from '@mcp-ui/client';
import { useThemeDetector } from '@/hooks/useThemeDetector';
import { useUIResourceActions } from '@/hooks/useUIResourceActions';
import type { UIResource, UIResourceDisplayMode } from '@/types/ui-resource';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Maximize2, Minimize2, PictureInPicture2, X } from 'lucide-react';
import { logger } from '@/services/logger';

// Type for UIResourceRenderer's resource prop (using any to avoid SDK type conflicts)
type RendererResource = Parameters<typeof UIResourceRenderer>[0]['resource'];

interface UIResourceMessageProps {
  resource: UIResource;
  serverId?: string;
  className?: string;
  onPrompt?: (prompt: string) => void;
  onToolCall?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Widget controls for display mode switching
 */
function WidgetControls({
  mode,
  onModeChange,
  onClose,
}: {
  mode: UIResourceDisplayMode;
  onModeChange: (mode: UIResourceDisplayMode) => void;
  onClose?: () => void;
}) {
  return (
    <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm rounded-md p-1">
      {mode !== 'fullscreen' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onModeChange('fullscreen')}
          title="Fullscreen"
        >
          <Maximize2 className="h-3 w-3" />
        </Button>
      )}
      {mode === 'fullscreen' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onModeChange('inline')}
          title="Exit Fullscreen"
        >
          <Minimize2 className="h-3 w-3" />
        </Button>
      )}
      {mode !== 'pip' && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onModeChange('pip')}
          title="Picture in Picture"
        >
          <PictureInPicture2 className="h-3 w-3" />
        </Button>
      )}
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/**
 * Loading fallback for UIResourceRenderer
 */
function UIResourceLoading() {
  return (
    <div className="flex items-center justify-center p-4 min-h-[100px] bg-muted/50 rounded-lg">
      <div className="animate-pulse text-muted-foreground text-sm">
        Loading widget...
      </div>
    </div>
  );
}

/**
 * Error boundary fallback
 */
function UIResourceError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center p-4 min-h-[100px] bg-destructive/10 border border-destructive/20 rounded-lg">
      <p className="text-destructive text-sm font-medium">Failed to load widget</p>
      <p className="text-muted-foreground text-xs mt-1">{error.message}</p>
    </div>
  );
}

/**
 * Main UIResourceMessage component
 */
export function UIResourceMessage({
  resource,
  serverId,
  className,
  onPrompt,
  onToolCall,
}: UIResourceMessageProps) {
  const theme = useThemeDetector();
  const [displayMode, setDisplayMode] = useState<UIResourceDisplayMode>('inline');
  const [error, setError] = useState<Error | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // PiP dragging state
  const [pipPosition, setPipPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const { handleUIAction } = useUIResourceActions({
    serverId,
    onPrompt,
    onToolCall,
  });

  // Check if this is a Skybridge widget
  const isSkybridge = useMemo(() => {
    const innerResource = resource.resource as { _meta?: { isSkybridge?: boolean } };
    return !!innerResource?._meta?.isSkybridge;
  }, [resource]);

  // Convert our UIResource to the format expected by UIResourceRenderer
  // The library expects the inner resource object { uri, mimeType, text/blob }
  // NOT the wrapped EmbeddedResource format { type: "resource", resource: {...} }
  const rendererResource = useMemo<RendererResource>(() => {
    // Extract inner resource from EmbeddedResource wrapper
    return resource.resource as unknown as RendererResource;
  }, [resource]);

  // Extract widget data from _meta for passing to iframeRenderData
  // This allows the HTML template to access the data via window.__IFRAME_RENDER_DATA__
  const widgetData = useMemo(() => {
    const innerResource = resource.resource as { _meta?: { widgetData?: Record<string, unknown>; props?: Record<string, unknown> } };
    const data = innerResource?._meta?.widgetData || innerResource?._meta?.props || {};
    logger.mcp.debug('UIResourceMessage extracting widget data', {
      hasInnerResource: !!innerResource,
      hasMeta: !!innerResource?._meta,
      hasWidgetData: !!innerResource?._meta?.widgetData,
      hasProps: !!innerResource?._meta?.props,
      dataKeys: Object.keys(data),
    });
    return data;
  }, [resource]);

  // Set up Skybridge bridge event listeners
  useEffect(() => {
    if (!isSkybridge) return;

    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || !data.type) return;

      // Only handle messages from child iframes
      // The source should be a window (iframe contentWindow)
      if (event.source === window) return;

      logger.mcp.debug('UIResourceMessage received bridge message', {
        type: data.type,
        hasPayload: !!data.payload,
      });

      switch (data.type) {
        case 'openai-bridge-call-tool': {
          // Handle tool call from Skybridge widget
          const { id, toolName, args } = data.payload || {};
          logger.mcp.info('Skybridge widget calling tool', { toolName, args, serverId });

          try {
            // Call MCP tool directly via IPC for Skybridge widgets
            if (serverId && window.levante?.mcp?.callTool) {
              const result = await window.levante.mcp.callTool(serverId, {
                name: toolName,
                arguments: args || {},
              });
              logger.mcp.info('Skybridge tool call result', { toolName, result });

              // Extract response data for widget
              // IPC result format: { success: boolean, data: { content, _meta, structuredContent } }
              const data = (result?.data || result) as any;
              const responseData = {
                structuredContent: data?.structuredContent,
                meta: data?._meta,
                content: data?.content,
              };

              logger.mcp.debug('Skybridge tool response to widget', { responseData });

              // Send response back to iframe
              (event.source as Window)?.postMessage({
                type: 'openai-bridge-call-tool-response',
                payload: { id, result: responseData },
              }, '*');
            } else if (onToolCall) {
              // Fallback to callback if provided
              const result = await onToolCall(toolName, args || {});
              (event.source as Window)?.postMessage({
                type: 'openai-bridge-call-tool-response',
                payload: { id, result },
              }, '*');
            } else {
              throw new Error(`Cannot call tool: serverId=${serverId}, mcp available=${!!window.levante?.mcp}`);
            }
          } catch (err) {
            logger.mcp.error('Skybridge tool call error', { toolName, error: err });
            (event.source as Window)?.postMessage({
              type: 'openai-bridge-call-tool-response',
              payload: { id, error: err instanceof Error ? err.message : String(err) },
            }, '*');
          }
          break;
        }

        case 'openai-bridge-follow-up': {
          // Handle follow-up message from widget
          const { message } = data.payload || {};
          logger.mcp.info('Skybridge widget sending follow-up', { message });
          if (message && onPrompt) {
            onPrompt(message);
          }
          break;
        }

        case 'openai-bridge-display-mode': {
          // Handle display mode change from widget
          const { mode } = data.payload || {};
          logger.mcp.info('Skybridge widget requesting display mode', { mode });
          if (mode === 'inline' || mode === 'pip' || mode === 'fullscreen') {
            setDisplayMode(mode);
          }
          break;
        }

        case 'openai-bridge-open-external': {
          // Handle external link from widget
          const { url } = data.payload || {};
          logger.mcp.info('Skybridge widget opening external URL', { url });
          if (url) {
            // Use Electron's shell.openExternal via IPC
            window.levante?.openExternal?.(url);
          }
          break;
        }

        case 'openai-bridge-close': {
          // Handle widget close request
          logger.mcp.info('Skybridge widget requesting close');
          setIsClosed(true);
          break;
        }

        case 'openai-bridge-set-state': {
          // Handle widget state update (currently just log it)
          const { state } = data.payload || {};
          logger.mcp.debug('Skybridge widget setting state', { state });
          // Widget state persistence could be implemented here in the future
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isSkybridge, onToolCall, onPrompt]);

  // Send initial globals to iframe when it's ready
  useEffect(() => {
    if (!isSkybridge) return;

    const handleReady = (event: MessageEvent) => {
      if (event.data?.type === 'ui-lifecycle-iframe-ready') {
        // Send globals update to the iframe
        (event.source as Window)?.postMessage({
          type: 'openai-bridge-set-globals',
          payload: {
            theme,
            locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
            displayMode,
          },
        }, '*');
      }
    };

    window.addEventListener('message', handleReady);
    return () => window.removeEventListener('message', handleReady);
  }, [isSkybridge, theme, displayMode]);

  const onUIAction = useCallback(
    async (action: UIActionResult) => {
      try {
        const result = await handleUIAction(action);
        return result;
      } catch (err) {
        logger.mcp.error('UIResource action error', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { status: 'error' };
      }
    },
    [handleUIAction]
  );

  // PiP drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pipPosition.x,
      posY: pipPosition.y,
    };
  }, [pipPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;
      setPipPosition({
        x: dragStartRef.current.posX + deltaX,
        y: dragStartRef.current.posY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Handle closed state
  if (isClosed) {
    return null;
  }

  // Handle errors
  if (error) {
    return <UIResourceError error={error} />;
  }

  // Inline mode
  if (displayMode === 'inline') {
    return (
      <div
        className={cn(
          'relative group rounded-lg overflow-hidden bg-background',
          'min-h-[100px]',
          className
        )}
      >
        <Suspense fallback={<UIResourceLoading />}>
          <UIResourceRenderer
            resource={rendererResource}
            onUIAction={onUIAction}
            htmlProps={{
              iframeRenderData: {
                theme,
                locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
                // Pass widget data for the HTML template to access
                ...widgetData,
              },
              // Auto-resize iframe based on content height
              autoResizeIframe: { height: true },
              style: {
                width: '100%',
                minHeight: '100px',
                border: 'none',
              },
            }}
            remoteDomProps={{
              library: basicComponentLibrary,
            }}
          />
        </Suspense>
        <WidgetControls mode={displayMode} onModeChange={setDisplayMode} />
      </div>
    );
  }

  // Fullscreen mode
  if (displayMode === 'fullscreen') {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        <div className="flex-1 p-4 overflow-auto">
          <Suspense fallback={<UIResourceLoading />}>
            <UIResourceRenderer
              resource={rendererResource}
              onUIAction={onUIAction}
              htmlProps={{
                iframeRenderData: {
                  theme,
                  locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
                  displayMode: 'fullscreen',
                  // Pass widget data for the HTML template to access
                  ...widgetData,
                },
                style: {
                  width: '100%',
                  height: '100%',
                  border: 'none',
                },
              }}
              remoteDomProps={{
                library: basicComponentLibrary,
              }}
            />
          </Suspense>
        </div>
        <WidgetControls
          mode={displayMode}
          onModeChange={setDisplayMode}
          onClose={() => setDisplayMode('inline')}
        />
      </div>
    );
  }

  // PiP mode
  if (displayMode === 'pip') {
    return (
      <>
        {/* Placeholder in original position */}
        <div
          className={cn(
            'rounded-lg border border-dashed bg-muted/20 p-4 text-center text-muted-foreground text-sm',
            className
          )}
        >
          Widget in Picture-in-Picture mode
        </div>

        {/* Floating PiP window */}
        <div
          className="fixed bottom-4 right-4 z-40 w-[400px] h-[300px] rounded-lg overflow-hidden shadow-lg bg-background group"
          style={{
            resize: 'both',
            transform: `translate(${pipPosition.x}px, ${pipPosition.y}px)`,
          }}
        >
          <div
            className="h-6 bg-muted flex items-center justify-between px-2 cursor-move select-none"
            onMouseDown={handleDragStart}
          >
            <span className="text-xs text-muted-foreground truncate">
              {resource.resource?.uri || 'Widget'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4"
              onClick={() => setDisplayMode('inline')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="h-[calc(100%-24px)]">
            <Suspense fallback={<UIResourceLoading />}>
              <UIResourceRenderer
                resource={rendererResource}
                onUIAction={onUIAction}
                htmlProps={{
                  iframeRenderData: {
                    theme,
                    locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
                    displayMode: 'pip',
                    // Pass widget data for the HTML template to access
                    ...widgetData,
                  },
                  style: {
                    width: '100%',
                    height: '100%',
                    border: 'none',
                  },
                }}
                remoteDomProps={{
                  library: basicComponentLibrary,
                }}
              />
            </Suspense>
          </div>
        </div>
      </>
    );
  }

  return null;
}

export default UIResourceMessage;
