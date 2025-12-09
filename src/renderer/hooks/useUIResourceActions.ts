/**
 * Hook to handle UI Resource actions from @mcp-ui/client
 */

import { useCallback } from 'react';
import type { UIActionResult } from '@mcp-ui/client';
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
            // Show notification
            const { message } = action.payload;

            // For now, just log the notification
            // TODO: Integrate with toast/notification system
            logger.mcp.info('UI Resource notification', { message });
            console.info('[UIResource Notification]', message);

            return { status: 'notified' };
          }

          case 'intent': {
            // Handle custom intent
            const { intent, params } = action.payload;

            logger.mcp.debug('UI Resource intent', { intent, params });

            // Custom intents can be handled by specific handlers
            // For now, just acknowledge
            return { status: 'intent_received', data: { intent, params } };
          }

          default: {
            logger.mcp.warn('Unknown UI action type', { action });
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
