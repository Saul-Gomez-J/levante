/**
 * Mini Chat Message
 *
 * Displays a single message in the mini-chat conversation.
 * User messages: simple text rendering
 * Assistant messages: rich content rendering with markdown, code, mermaid, etc.
 */

import React from 'react';
import { type UIMessage } from '@ai-sdk/react';
import { MiniChatRichMessage } from './MiniChatRichMessage';

/**
 * Helper function to extract text content from UIMessage parts (AI SDK v5)
 */
function getMessageContent(message: UIMessage): string {
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

interface MiniChatMessageProps {
  message: UIMessage;
  isStreaming?: boolean;
}

export function MiniChatMessage({ message, isStreaming }: MiniChatMessageProps) {
  const { role, parts } = message;
  const content = getMessageContent(message);

  return (
    <div className={`mini-chat-message ${role}${isStreaming ? ' streaming' : ''}`}>
      {role === 'user' ? (
        // User messages: simple text display
        <div className="mini-chat-message-content">
          {content}
        </div>
      ) : (
        // Assistant messages: rich content rendering
        <MiniChatRichMessage message={message} isStreaming={isStreaming} />
      )}
    </div>
  );
}
