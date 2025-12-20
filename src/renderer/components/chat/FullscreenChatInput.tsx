/**
 * FullscreenChatInput - Chat overlay for fullscreen widget mode
 * Includes title, close button, chat history, and input in bottom bar
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronUp, ChevronDown, ArrowUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Streamdown } from 'streamdown';
import remarkGfm from 'remark-gfm';
import type { BundledTheme } from 'shiki';

// Shiki theme tuple for code highlighting
const shikiTheme: [BundledTheme, BundledTheme] = ['github-light', 'github-dark'];

// Custom components for proper list rendering (same as Response component)
const listComponents = {
  ul: ({ className, ...props }: any) => (
    <ul className={cn("ml-4 list-outside list-disc", className)} {...props} />
  ),
  ol: ({ className, ...props }: any) => (
    <ol className={cn("ml-4 list-outside list-decimal", className)} {...props} />
  ),
  li: ({ className, ...props }: any) => (
    <li className={cn("py-0.5", className)} {...props} />
  ),
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface FullscreenChatInputProps {
  onSubmit: (message: string) => void;
  onClose: () => void;
  widgetName: string;
  messages?: ChatMessage[];
  disabled?: boolean;
  placeholder?: string;
}

export function FullscreenChatInput({
  onSubmit,
  onClose,
  widgetName,
  messages = [],
  disabled = false,
  placeholder = 'Ask something...',
}: FullscreenChatInputProps) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (expanded && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, expanded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (expanded) {
        setExpanded(false);
      } else {
        onClose();
      }
    }
  };

  // Collapsed state: floating bar at bottom
  if (!expanded) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-2xl px-3 py-2 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setExpanded(true)}
          >
            <ChevronUp className="h-4 w-4" />
            Chat
          </Button>
          <span className="text-sm font-medium text-muted-foreground truncate max-w-48">
            {widgetName}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            title="Close fullscreen"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Expanded state: floating centered chat window
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-md px-4">
      <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-2xl flex flex-col max-h-[50vh]">
          {/* Chat history */}
          {messages.length > 0 && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 min-h-0 border-b">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'text-sm p-2 rounded-lg overflow-hidden',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground ml-auto max-w-[85%]'
                      : 'bg-muted'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <Streamdown
                      className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 overflow-hidden [&_table]:text-xs [&_.my-4]:my-2"
                      components={listComponents}
                      remarkPlugins={[remarkGfm]}
                      shikiTheme={shikiTheme}
                    >
                      {msg.content}
                    </Streamdown>
                  ) : (
                    msg.content
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input bar */}
          <div className="p-3">
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => setExpanded(false)}
                title="Collapse"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 shrink-0"
                disabled={!input.trim() || disabled}
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={onClose}
                title="Close fullscreen"
              >
                <X className="h-4 w-4" />
              </Button>
            </form>
            <div className="text-xs text-muted-foreground text-center mt-2 truncate">
              {widgetName}
            </div>
          </div>
        </div>
      </div>
  );
}
