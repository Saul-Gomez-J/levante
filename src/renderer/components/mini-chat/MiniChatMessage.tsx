/**
 * Mini Chat Message
 *
 * Displays a single message in the mini-chat conversation.
 * User messages: simple text rendering
 * Assistant messages: rich content rendering with markdown, code, mermaid, etc.
 */

import React from 'react';
import { MiniChatRichMessage } from './MiniChatRichMessage';

interface MiniChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    parts?: Array<any>;
  };
  isStreaming?: boolean;
}

export function MiniChatMessage({ message, isStreaming }: MiniChatMessageProps) {
  const { role, content, parts } = message;

  return (
    <div className={`mini-chat-message ${role}${isStreaming ? ' streaming' : ''}`}>
      {role === 'user' ? (
        // User messages: simple text display with fallback to parts
        <div className="mini-chat-message-content">
          {content || (parts?.[0]?.type === 'text' ? parts[0].text : '')}
        </div>
      ) : (
        // Assistant messages: rich content rendering
        <MiniChatRichMessage message={message} isStreaming={isStreaming} />
      )}
    </div>
  );
}
