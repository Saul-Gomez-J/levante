/**
 * Mini Chat Message
 * 
 * Displays a single message in the mini-chat conversation.
 * Supports basic markdown rendering for assistant messages.
 */

import React from 'react';

interface MiniChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  };
  isStreaming?: boolean;
}

export function MiniChatMessage({ message, isStreaming }: MiniChatMessageProps) {
  const { role, content } = message;

  // Simple markdown-like rendering for code blocks
  const renderContent = (text: string) => {
    // Handle code blocks
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {text.slice(lastIndex, match.index)}
          </span>
        );
      }

      // Add code block
      const [, language, code] = match;
      parts.push(
        <pre key={`code-${match.index}`} className="mini-chat-code-block">
          {language && <span className="mini-chat-code-lang">{language}</span>}
          <code>{code.trim()}</code>
        </pre>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {text.slice(lastIndex)}
        </span>
      );
    }

    return parts.length > 0 ? parts : text;
  };

  return (
    <div className={`mini-chat-message ${role}${isStreaming ? ' streaming' : ''}`}>
      <div className="mini-chat-message-content">
        {renderContent(content)}
        {isStreaming && <span className="mini-chat-cursor">▊</span>}
      </div>
    </div>
  );
}
