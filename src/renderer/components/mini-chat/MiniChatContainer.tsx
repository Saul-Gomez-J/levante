/**
 * Mini Chat Container
 * 
 * Main container component that orchestrates the mini-chat UI.
 */

import React, { useRef, useEffect } from 'react';
import { MiniChatHeader } from './MiniChatHeader';
import { MiniChatMessage } from './MiniChatMessage';
import { MiniChatInput } from './MiniChatInput';
import { useMiniChatStore } from '@/stores/miniChatStore';

export function MiniChatContainer() {
  const { messages, isStreaming, streamingContent, error } = useMiniChatStore();
  const messagesRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const hasContent = messages.length > 0 || isStreaming;

  return (
    <div className="mini-chat-container">
      <MiniChatHeader />

      {error && (
        <div className="mini-chat-error">
          <span className="mini-chat-error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {hasContent && (
        <div ref={messagesRef} className="mini-chat-messages">
          {messages.map((msg) => (
            <MiniChatMessage key={msg.id} message={msg} />
          ))}

          {isStreaming && streamingContent && (
            <MiniChatMessage
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamingContent,
                timestamp: new Date(),
              }}
              isStreaming
            />
          )}

          {isStreaming && !streamingContent && (
            <div className="mini-chat-message assistant">
              <div className="streaming-indicator">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
        </div>
      )}

      <MiniChatInput />
    </div>
  );
}
