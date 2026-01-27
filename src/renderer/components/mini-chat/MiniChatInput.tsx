/**
 * Mini Chat Input
 * 
 * Input field for quick chat interactions.
 * Supports Enter to send, Shift+Enter for newline.
 */

import React, { useRef, useEffect } from 'react';
import { useMiniChatStore } from '@/stores/miniChatStore';

export function MiniChatInput() {
  const { inputValue, setInputValue, sendMessage, isStreaming } = useMiniChatStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus input when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && inputValue.trim()) {
        sendMessage();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStreaming && inputValue.trim()) {
      sendMessage();
    }
  };

  return (
    <form className="mini-chat-input-container" onSubmit={handleSubmit}>
      <textarea
        ref={inputRef}
        className="mini-chat-input"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything... (Enter to send)"
        disabled={isStreaming}
        rows={1}
      />
      <button
        type="submit"
        className="mini-chat-send-btn"
        disabled={isStreaming || !inputValue.trim()}
      >
        {isStreaming ? (
          <span className="mini-chat-spinner" />
        ) : (
          <span>↑</span>
        )}
      </button>
    </form>
  );
}
