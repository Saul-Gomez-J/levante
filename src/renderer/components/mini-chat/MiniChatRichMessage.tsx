/**
 * Mini Chat Rich Message
 *
 * Adapts mini-chat messages for rich content rendering using existing Response component.
 * Handles markdown, code blocks, mermaid diagrams, and tool calls in a compact format.
 */

import React from 'react';
import { Response } from '@/components/ai-elements/response';
import { Wrench, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

interface MiniChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  parts?: Array<any>;
}

interface MiniChatRichMessageProps {
  message: MiniChatMessage;
  isStreaming?: boolean;
}

interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args?: Record<string, any>;
  result?: any;
}

interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: any;
  isError?: boolean;
}

// ═══════════════════════════════════════════════════════
// SIMPLIFIED TOOL CALL COMPONENT
// ═══════════════════════════════════════════════════════

const statusIcons = {
  pending: { icon: Clock, label: '⏳', className: 'text-muted-foreground' },
  running: { icon: Clock, label: '⚙️', className: 'text-muted-foreground animate-pulse' },
  success: { icon: CheckCircle2, label: '✅', className: 'text-green-600 dark:text-green-400' },
  error: { icon: XCircle, label: '❌', className: 'text-red-600 dark:text-red-400' },
};

function MiniChatToolCall({
  toolName,
  status = 'success',
  onClick,
  disabled = false
}: {
  toolName: string;
  status?: 'pending' | 'running' | 'success' | 'error';
  onClick?: () => void;
  disabled?: boolean;
}) {
  const statusInfo = statusIcons[status];

  return (
    <div
      className="mini-chat-tool-call"
      onClick={disabled ? undefined : onClick}
      role={onClick && !disabled ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onKeyDown={(e) => {
        if (!disabled && onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: onClick && !disabled ? 'pointer' : 'default',
        opacity: disabled ? 0.5 : 1
      }}
    >
      <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-medium text-xs">{toolName}</span>
      <span className="ml-auto">{statusInfo.label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════

/**
 * Renders assistant messages with rich content support.
 * Falls back to simple content rendering if parts are unavailable.
 */
export function MiniChatRichMessage({ message, isStreaming }: MiniChatRichMessageProps) {
  const { content, parts } = message;

  // DEBUGGING: Log message structure
  console.log('[MiniChatRichMessage] Processing message:', {
    id: message.id,
    role: message.role,
    hasContent: !!content,
    contentType: typeof content,
    contentValue: content,
    hasParts: !!parts,
    partsLength: parts?.length,
    partsDetail: parts?.map((p, i) => ({
      index: i,
      type: typeof p,
      value: p,
      isObject: p && typeof p === 'object',
      hasType: p && typeof p === 'object' && 'type' in p,
      typeValue: p && typeof p === 'object' && 'type' in p ? p.type : undefined,
      keys: p && typeof p === 'object' ? Object.keys(p) : []
    }))
  });

  // Filter out empty JSON objects/arrays from parts
  const isEmptyJSON = (part: any): boolean => {
    if (!part || typeof part !== 'object') return false;
    const str = JSON.stringify(part);
    return str === '{}' || str === '[]';
  };

  // Handler to open conversation in main window
  const handleOpenInMain = async () => {
    try {
      // Get mini-chat store state
      const miniChatStore = await import('@/stores/miniChatStore');
      const { selectedModel, currentSessionId } = miniChatStore.useMiniChatStore.getState();

      if (!currentSessionId) {
        console.warn('No session ID available - cannot transfer to main window');
        return;
      }

      console.log('Transferring conversation to main window', {
        model: selectedModel,
        sessionId: currentSessionId,
      });

      // Call IPC to transfer conversation
      // Now we only pass sessionId - messages are already in DB
      const result = await window.levante.miniChat.openInMainWindow({
        messages: [], // Empty - not needed anymore
        model: selectedModel,
        sessionId: currentSessionId,
      });

      if (!result.success) {
        console.error('Failed to open in main window:', result.error);
      }
    } catch (error) {
      console.error('Error opening in main window:', error);
    }
  };

  // If no parts or only empty parts, fall back to simple content rendering
  if (!parts || parts.length === 0 || parts.every(isEmptyJSON)) {
    return (
      <div className="mini-chat-message-content mini-chat-response">
        <Response>{content}</Response>
        {isStreaming && <span className="mini-chat-cursor">▊</span>}
      </div>
    );
  }

  // Render parts with appropriate components
  try {
    return (
      <div className="mini-chat-message-content mini-chat-response">
        {parts.map((part, index) => {
          try {
            console.log(`[MiniChatRichMessage] Processing part ${index}:`, {
              partType: typeof part,
              partValue: part,
              isObject: part && typeof part === 'object',
              hasTypeKey: part && typeof part === 'object' && 'type' in part,
              typeValue: part && typeof part === 'object' && 'type' in part ? part.type : 'N/A'
            });

            // Skip empty JSON objects
            if (isEmptyJSON(part)) {
              console.log(`[MiniChatRichMessage] Skipping empty JSON at index ${index}`);
              return null;
            }

            // Validate that part is an object before accessing properties
            if (!part || typeof part !== 'object') {
              console.warn('[MiniChatRichMessage] Invalid part type:', typeof part, part);
              return null;
            }

        // Text part - use Response component for rich markdown
        if (part.type === 'text' && part.text) {
          return (
            <Response key={`text-${index}`}>
              {part.text}
            </Response>
          );
        }

        // Tool call part - clickeable to open in main window
        if (part.type === 'tool-call') {
          const toolPart = part as ToolCallPart;
          return (
            <MiniChatToolCall
              key={`tool-call-${index}`}
              toolName={toolPart.toolName}
              status="running"
              onClick={handleOpenInMain}
              disabled={isStreaming}
            />
          );
        }

        // Tool result part - clickeable to open in main window
        if (part.type === 'tool-result') {
          const toolResult = part as ToolResultPart;
          return (
            <MiniChatToolCall
              key={`tool-result-${index}`}
              toolName={toolResult.toolName}
              status={toolResult.isError ? 'error' : 'success'}
              onClick={handleOpenInMain}
              disabled={isStreaming}
            />
          );
        }

            // Unknown part type - skip
            console.log(`[MiniChatRichMessage] Unknown part type at index ${index}:`, part.type);
            return null;
          } catch (partError) {
            console.error(`[MiniChatRichMessage] Error rendering part ${index}:`, {
              error: partError,
              errorMessage: partError instanceof Error ? partError.message : String(partError),
              errorStack: partError instanceof Error ? partError.stack : undefined,
              partType: typeof part,
              partValue: part
            });
            return null;
          }
        })}

        {isStreaming && <span className="mini-chat-cursor">▊</span>}
      </div>
    );
  } catch (error) {
    console.error('[MiniChatRichMessage] Error rendering parts:', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      message: message,
      parts: parts
    });
    // Fallback to simple rendering
    return (
      <div className="mini-chat-message-content mini-chat-response">
        <Response>{content}</Response>
        {isStreaming && <span className="mini-chat-cursor">▊</span>}
      </div>
    );
  }
}
