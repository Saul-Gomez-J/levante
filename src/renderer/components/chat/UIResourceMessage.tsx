/**
 * UIResourceMessage - Renders MCP UI Resources using @mcp-ui/client
 */

import React, { useState, useCallback, Suspense, useMemo } from 'react';
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

  const { handleUIAction } = useUIResourceActions({
    serverId,
    onPrompt,
    onToolCall,
  });

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
          style={{ resize: 'both' }}
        >
          <div className="h-6 bg-muted flex items-center justify-between px-2 cursor-move">
            <span className="text-xs text-muted-foreground truncate">
              {resource.resource?.uri || 'Widget'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4"
              onClick={() => setDisplayMode('inline')}
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
