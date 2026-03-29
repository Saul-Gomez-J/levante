/**
 * Mini Chat Container (Refactored with useChat)
 *
 * Main container component that orchestrates the mini-chat UI.
 * Uses the native useChat hook from @ai-sdk/react for consistency with main chat.
 */

import React, { useRef, useEffect, useMemo } from 'react';
import { MiniChatHeader } from './MiniChatHeader';
import { MiniChatMessage } from './MiniChatMessage';
import { MiniChatInput } from './MiniChatInput';
import { useMiniChatStore } from '@/stores/miniChatStore';
import { StreamingProvider } from '@/contexts/StreamingContext';
import { useChat, type UIMessage } from '@ai-sdk/react';
import { createElectronChatTransport } from '@/transports/ElectronChatTransport';
import { useChatStore } from '@/stores/chatStore';

/**
 * Helper function to extract text content from UIMessage parts (AI SDK v5)
 * In v5, messages no longer have a direct 'content' property - we must extract from parts
 */
function getMessageContent(message: UIMessage): string {
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

export function MiniChatContainer() {
  const { selectedModel, error, currentSessionId, ensureSession, setCurrentSessionId } = useMiniChatStore();
  const messagesRef = useRef<HTMLDivElement>(null);

  // Get persistMessage from chat store
  const persistMessage = useChatStore((state) => state.persistMessage);

  // Create transport with current configuration
  const transport = useMemo(
    () =>
      createElectronChatTransport({
        model: selectedModel || 'openai/gpt-4o',
        enableMCP: true,
      }),
    []
  );

  // Update transport options when model changes
  useEffect(() => {
    if (selectedModel) {
      transport.updateOptions({
        model: selectedModel,
        enableMCP: true,
      });
    }
  }, [selectedModel, transport]);

  // Use AI SDK native useChat hook
  // IMPORTANT: Use a fixed ID to prevent hook reset when session is created
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    error: chatError,
  } = useChat({
    id: 'mini-chat',
    transport,

    // Persist messages after AI finishes
    onFinish: async ({ message }) => {
      // Get latest session ID from store (avoid closure issue)
      const sessionId = useMiniChatStore.getState().currentSessionId;

      if (!sessionId) {
        console.error('[MiniChat onFinish] No session ID available - user message should have created it');
        return;
      }

      // Persist the AI response using the same logic as main chat
      try {
        // Extract text content from parts (with type validation)
        const textParts = message.parts?.filter((p: any) => {
          return p && typeof p === 'object' && p.type === 'text';
        }) || [];

        let content = textParts
          .map((p: any) => p.text)
          .join('\n')
          .trim();

        // Extract tool calls from parts (with type validation)
        const toolCallParts = message.parts?.filter((p: any) => {
          return p && typeof p === 'object' && typeof p.type === 'string' && p.type.startsWith('tool-');
        }) || [];

        let toolCallsData = null;
        if (toolCallParts.length > 0) {
          toolCallsData = toolCallParts.map((part: any) => ({
            id: part.toolCallId || `tool-${Date.now()}`,
            name: part.type.replace('tool-', ''),
            arguments: part.input || {},
            result: part.output,
            status: part.state === 'output-available' ? 'success' : part.state,
          }));
        }

        // Create message in database
        const result = await window.levante.db.messages.create({
          id: message.id,
          session_id: sessionId,
          role: message.role,
          content: content || '',
          tool_calls: toolCallsData,
          attachments: null,
          reasoningText: null,
        });

        if (!result.success) {
          console.error('Failed to persist mini-chat message:', result.error);
        }

        // Track model usage (fire and forget)
        const currentModel = useMiniChatStore.getState().selectedModel;
        if (currentModel) {
          window.levante.analytics?.trackModelUsage?.(currentModel, 'mini-chat').catch(() => {});
        }
      } catch (error) {
        console.error('Error persisting mini-chat message:', error);
      }
    },
  });

  const isStreaming = status === 'submitted';

  // Clear messages callback for header
  const handleClearMessages = () => {
    setMessages([]);
    setCurrentSessionId(null); // Reset session so next message creates a new one
  };

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const hasContent = messages.length > 0 || isStreaming;

  return (
    <div className="mini-chat-container">
      <MiniChatHeader onClearMessages={handleClearMessages} />

      {error && (
        <div className="mini-chat-error">
          <span className="mini-chat-error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {chatError && (
        <div className="mini-chat-error">
          <span className="mini-chat-error-icon">⚠️</span>
          <span>{chatError.message}</span>
        </div>
      )}

      {hasContent && (
        <StreamingProvider>
          <div ref={messagesRef} className="mini-chat-messages">
            {messages.map((msg) => (
              <MiniChatMessage
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id}
              />
            ))}

            {isStreaming && messages.length === 0 && (
              <div className="mini-chat-message assistant">
                <div className="streaming-indicator">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
          </div>
        </StreamingProvider>
      )}

      <MiniChatInput
        sendMessage={sendMessage}
        isStreaming={isStreaming}
        stop={stop}
      />
    </div>
  );
}
