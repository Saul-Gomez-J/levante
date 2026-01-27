/**
 * Mini Chat Store
 * 
 * Lightweight Zustand store for the mini-chat window.
 * Manages conversation state and model selection for quick interactions.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface MiniChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface MiniChatState {
  // UI State
  isVisible: boolean;
  isStreaming: boolean;
  streamingContent: string;
  
  // Chat State
  messages: MiniChatMessage[];
  selectedModel: string;
  inputValue: string;
  
  // Error State
  error: string | null;

  // Actions
  setIsVisible: (visible: boolean) => void;
  setSelectedModel: (model: string) => void;
  setInputValue: (value: string) => void;
  setError: (error: string | null) => void;
  
  // Message Actions
  addUserMessage: (content: string) => string;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (delta: string) => void;
  finalizeAssistantMessage: () => void;
  
  // Reset
  reset: () => void;
  clearMessages: () => void;

  // Async Actions
  sendMessage: () => Promise<void>;
}

const generateId = () => crypto.randomUUID();

export const useMiniChatStore = create<MiniChatState>()(
  devtools(
    (set, get) => ({
      // Initial State
      isVisible: false,
      isStreaming: false,
      streamingContent: '',
      messages: [],
      selectedModel: '',
      inputValue: '',
      error: null,

      // Basic Setters
      setIsVisible: (visible) => set({ isVisible: visible }),
      setSelectedModel: (model) => set({ selectedModel: model }),
      setInputValue: (value) => set({ inputValue: value }),
      setError: (error) => set({ error }),

      // Message Actions
      addUserMessage: (content) => {
        const id = generateId();
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id,
              role: 'user',
              content,
              timestamp: new Date(),
            },
          ],
        }));
        return id;
      },

      setStreamingContent: (content) => set({ streamingContent: content }),

      appendStreamingContent: (delta) =>
        set((state) => ({
          streamingContent: state.streamingContent + delta,
        })),

      finalizeAssistantMessage: () =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: generateId(),
              role: 'assistant',
              content: state.streamingContent,
              timestamp: new Date(),
            },
          ],
          streamingContent: '',
          isStreaming: false,
        })),

      // Reset Actions
      reset: () =>
        set({
          messages: [],
          streamingContent: '',
          isStreaming: false,
          inputValue: '',
          error: null,
        }),

      clearMessages: () =>
        set({
          messages: [],
          streamingContent: '',
          isStreaming: false,
        }),

      // Send Message
      sendMessage: async () => {
        const { inputValue, selectedModel, messages, addUserMessage } = get();
        
        if (!inputValue.trim()) return;
        if (!selectedModel) {
          set({ error: 'Please select a model first' });
          return;
        }

        const userContent = inputValue.trim();
        set({ inputValue: '', error: null, isStreaming: true, streamingContent: '' });
        
        // Add user message
        addUserMessage(userContent);

        // Resize window to show conversation
        try {
          await window.levante?.miniChat?.resize?.(400);
        } catch {
          // Ignore resize errors
        }

        try {
          // Build messages for API (UIMessage format requires 'parts')
          const allMessages = [
            ...messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              createdAt: m.timestamp,
              parts: [{ type: 'text' as const, text: m.content }],
            })),
            {
              id: generateId(),
              role: 'user' as const,
              content: userContent,
              createdAt: new Date(),
              parts: [{ type: 'text' as const, text: userContent }],
            },
          ];

          // Stream chat response
          await window.levante.streamChat(
            {
              messages: allMessages,
              model: selectedModel,
              webSearch: false,
            },
            (chunk) => {
              if (chunk.delta) {
                get().appendStreamingContent(chunk.delta);
              }
              if (chunk.done) {
                get().finalizeAssistantMessage();
              }
              if (chunk.error) {
                set({ 
                  error: chunk.error, 
                  isStreaming: false 
                });
              }
            }
          );
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to send message',
            isStreaming: false,
          });
        }
      },
    }),
    { name: 'mini-chat-store' }
  )
);
