/**
 * Mini Chat Input (Refactored with useChat)
 *
 * Input field for quick chat interactions.
 * Supports Enter to send, Shift+Enter for newline.
 */

import React, { useRef, useEffect } from 'react';
import { useMiniChatStore } from '@/stores/miniChatStore';
import { useChat } from '@ai-sdk/react';

interface MiniChatInputProps {
  sendMessage: ReturnType<typeof useChat>['sendMessage'];
  isStreaming: boolean;
  stop: () => void;
}

export function MiniChatInput({ sendMessage, isStreaming, stop }: MiniChatInputProps) {
  const { inputValue, setInputValue, selectedModel, setError, ensureSession, currentSessionId, setCurrentSessionId } = useMiniChatStore();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus input when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    if (!selectedModel) {
      setError('Please select a model first');
      return;
    }

    const userContent = inputValue.trim();
    setInputValue(''); // Clear input immediately
    setError(null);

    try {
      // Generate ID once and use it for both persistence and useChat
      const messageId = `user-${Date.now()}`;

      // Ensure session exists before first message
      if (!currentSessionId) {
        const sessionId = await ensureSession(selectedModel);
        if (!sessionId) {
          setError('Failed to create session');
          return;
        }
        setCurrentSessionId(sessionId);

        // Persist the user message manually for first message with the same ID
        await window.levante.db.messages.create({
          id: messageId,  // ← Use same ID
          session_id: sessionId,
          role: 'user',
          content: userContent,
          tool_calls: null,
          attachments: null,
          reasoningText: null,
        });
      } else {
        // For subsequent messages, also persist user message with same ID
        await window.levante.db.messages.create({
          id: messageId,  // ← Use same ID
          session_id: currentSessionId,
          role: 'user',
          content: userContent,
          tool_calls: null,
          attachments: null,
          reasoningText: null,
        });
      }

      // Resize window to show conversation
      try {
        await window.levante?.miniChat?.resize?.(400);
      } catch {
        // Ignore resize errors
      }

      // Send message to AI
      await sendMessage({
        id: messageId,  // ← Same ID as persisted in DB
        role: 'user',
        parts: [{ type: 'text', text: userContent }],
      });
    } catch (error) {
      console.error('Error sending mini-chat message:', error);
      setError(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && inputValue.trim()) {
        handleSend();
      }
    }

    // Escape to stop
    if (e.key === 'Escape' && isStreaming) {
      stop();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      stop();
    } else if (inputValue.trim()) {
      handleSend();
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
        disabled={false}
        rows={1}
      />
      <button
        type="submit"
        className="mini-chat-send-btn"
        disabled={!isStreaming && !inputValue.trim()}
      >
        {isStreaming ? (
          <span className="mini-chat-stop">⏹</span>
        ) : (
          <span>↑</span>
        )}
      </button>
    </form>
  );
}
