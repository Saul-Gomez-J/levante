/**
 * Hook to handle UI Resource actions from @mcp-ui/client
 */

import { useCallback } from 'react';
import type { UIActionResult } from '@mcp-ui/client';
import { toast } from 'sonner';
import { logger } from '@/services/logger';

interface UseUIResourceActionsOptions {
  serverId?: string;
  onPrompt?: (prompt: string) => void;
  onToolCall?: (toolName: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface UseUIResourceActionsReturn {
  handleUIAction: (action: UIActionResult) => Promise<{ status: string; data?: unknown }>;
}

/**
 * Hook to handle UI actions from UIResourceRenderer
 * Maps MCP-UI actions to Levante's systems
 */
export function useUIResourceActions(
  options: UseUIResourceActionsOptions = {}
): UseUIResourceActionsReturn {
  const { serverId, onPrompt, onToolCall } = options;

  const handleUIAction = useCallback(
    async (action: UIActionResult): Promise<{ status: string; data?: unknown }> => {
      logger.mcp.debug('UIResource action received', {
        type: action.type,
        serverId,
        payload: action.payload,
      });

      try {
        switch (action.type) {
          case 'tool': {
            // Execute MCP tool call
            const { toolName, params } = action.payload;

            if (onToolCall) {
              const result = await onToolCall(toolName, params as Record<string, unknown>);
              return { status: 'tool_executed', data: result };
            }

            // Fallback: call tool via IPC if serverId is provided
            if (serverId) {
              const result = await window.levante.mcp.callTool(serverId, {
                name: toolName,
                arguments: params as Record<string, unknown>,
              });

              if (result.success) {
                return { status: 'tool_executed', data: result.data };
              } else {
                logger.mcp.error('Tool call failed', { toolName, error: result.error });
                return { status: 'tool_error', data: { error: result.error } };
              }
            }

            logger.mcp.warn('Tool call requested but no handler or serverId', { toolName });
            return { status: 'no_handler' };
          }

          case 'prompt': {
            // Send follow-up message to chat
            const { prompt } = action.payload;

            if (onPrompt) {
              onPrompt(prompt);
              return { status: 'prompt_sent' };
            }

            logger.mcp.warn('Prompt action requested but no handler', { prompt });
            return { status: 'no_handler' };
          }

          case 'link': {
            // Open external link
            const { url } = action.payload;

            // Validate URL
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              logger.mcp.warn('Invalid URL scheme for external link', { url });
              return { status: 'invalid_url' };
            }

            const result = await window.levante.openExternal(url);

            if (result.success) {
              return { status: 'link_opened' };
            } else {
              logger.mcp.error('Failed to open external link', { url, error: result.error });
              return { status: 'link_error', data: { error: result.error } };
            }
          }

          case 'notify': {
            // Show notification using sonner toast
            const { message, type = 'info', title, duration } = action.payload as {
              message: string;
              type?: 'success' | 'error' | 'warning' | 'info';
              title?: string;
              duration?: number;
            };

            logger.mcp.debug('UI Resource notification', { message, type, title });

            const toastOptions = {
              description: title ? message : undefined,
              duration: duration ?? 4000,
            };

            const displayMessage = title || message;

            switch (type) {
              case 'success':
                toast.success(displayMessage, toastOptions);
                break;
              case 'error':
                toast.error(displayMessage, toastOptions);
                break;
              case 'warning':
                toast.warning(displayMessage, toastOptions);
                break;
              case 'info':
              default:
                toast.info(displayMessage, toastOptions);
                break;
            }

            return { status: 'notified' };
          }

          case 'intent': {
            // Handle custom intent - desktop-applicable actions
            const { intent, params } = action.payload as {
              intent: string;
              params?: Record<string, unknown>;
            };

            logger.mcp.debug('UI Resource intent', { intent, params });

            switch (intent) {
              case 'copy': {
                // Copy text to clipboard
                const text = params?.text as string;
                if (!text) {
                  logger.mcp.warn('Copy intent missing text parameter');
                  return { status: 'intent_error', data: { error: 'Missing text parameter' } };
                }

                try {
                  await navigator.clipboard.writeText(text);
                  toast.success('Copied to clipboard');
                  return { status: 'intent_completed', data: { intent: 'copy' } };
                } catch (error) {
                  logger.mcp.error('Failed to copy to clipboard', { error });
                  toast.error('Failed to copy to clipboard');
                  return { status: 'intent_error', data: { error: 'Clipboard access denied' } };
                }
              }

              case 'download': {
                // Download file - create a blob and trigger download
                const { url, filename, content, mimeType } = params as {
                  url?: string;
                  filename?: string;
                  content?: string;
                  mimeType?: string;
                };

                try {
                  if (url) {
                    // Download from URL - open in browser to trigger download
                    const result = await window.levante.openExternal(url);
                    if (result.success) {
                      toast.success(`Downloading ${filename || 'file'}...`);
                      return { status: 'intent_completed', data: { intent: 'download' } };
                    } else {
                      throw new Error(result.error);
                    }
                  } else if (content) {
                    // Download from content - create blob and trigger download
                    const blob = new Blob([content], { type: mimeType || 'text/plain' });
                    const downloadUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = filename || 'download.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(downloadUrl);
                    toast.success(`Downloaded ${filename || 'file'}`);
                    return { status: 'intent_completed', data: { intent: 'download' } };
                  } else {
                    logger.mcp.warn('Download intent missing url or content parameter');
                    return { status: 'intent_error', data: { error: 'Missing url or content parameter' } };
                  }
                } catch (error) {
                  logger.mcp.error('Failed to download', { error });
                  toast.error('Failed to download file');
                  return { status: 'intent_error', data: { error: String(error) } };
                }
              }

              case 'navigate': {
                // Navigate to URL (opens in external browser for desktop)
                const url = params?.url as string;
                if (!url) {
                  logger.mcp.warn('Navigate intent missing url parameter');
                  return { status: 'intent_error', data: { error: 'Missing url parameter' } };
                }

                // Validate URL scheme
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                  logger.mcp.warn('Invalid URL scheme for navigate intent', { url });
                  return { status: 'intent_error', data: { error: 'Invalid URL scheme' } };
                }

                const result = await window.levante.openExternal(url);
                if (result.success) {
                  return { status: 'intent_completed', data: { intent: 'navigate' } };
                } else {
                  logger.mcp.error('Failed to navigate', { url, error: result.error });
                  toast.error('Failed to open URL');
                  return { status: 'intent_error', data: { error: result.error } };
                }
              }

              case 'select':
                // Phase 8 feature - not implemented yet
                logger.mcp.info('Select intent is a Phase 8 feature', { params });
                return { status: 'intent_not_implemented', data: { intent: 'select' } };

              default:
                // Unknown intent - log and acknowledge
                logger.mcp.warn('Unknown intent type', { intent, params });
                return { status: 'intent_unknown', data: { intent, params } };
            }
          }

          default: {
            // Ignore Skybridge bridge messages - handled directly by UIResourceMessage
            const unknownAction = action as { type: string };
            if (typeof unknownAction.type === 'string' && unknownAction.type.startsWith('openai-bridge-')) {
              return { status: 'ignored' };
            }
            logger.mcp.warn('Unknown UI action type', { action: unknownAction });
            return { status: 'unknown_action' };
          }
        }
      } catch (error) {
        logger.mcp.error('Error handling UI action', {
          type: action.type,
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: 'error', data: { error: String(error) } };
      }
    },
    [serverId, onPrompt, onToolCall]
  );

  return { handleUIAction };
}
