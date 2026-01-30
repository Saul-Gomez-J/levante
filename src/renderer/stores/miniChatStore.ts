/**
 * Mini Chat Store (Simplified)
 *
 * Lightweight Zustand store for the mini-chat window.
 * Manages only UI state - messages are handled by useChat hook.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface MiniChatState {
  // UI State
  isVisible: boolean;
  selectedModel: string;
  inputValue: string;
  error: string | null;

  // Session Management
  currentSessionId: string | null;

  // Actions
  setIsVisible: (visible: boolean) => void;
  setSelectedModel: (model: string) => void;
  setInputValue: (value: string) => void;
  setError: (error: string | null) => void;
  setCurrentSessionId: (sessionId: string | null) => void;

  // Session Management
  ensureSession: (model: string) => Promise<string | null>;

  // Reset
  reset: () => void;
}

export const useMiniChatStore = create<MiniChatState>()(
  devtools(
    (set, get) => ({
      // Initial State
      isVisible: false,
      selectedModel: '',
      inputValue: '',
      error: null,
      currentSessionId: null,

      // Basic Setters
      setIsVisible: (visible) => set({ isVisible: visible }),
      setSelectedModel: (model) => set({ selectedModel: model }),
      setInputValue: (value) => set({ inputValue: value }),
      setError: (error) => set({ error }),
      setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),

      // Ensure session exists before persisting messages
      ensureSession: async (model: string) => {
        const { currentSessionId } = get();

        // If session already exists, return it
        if (currentSessionId) {
          return currentSessionId;
        }

        // Create new session
        try {
          const title = 'Mini Chat';

          // Call IPC to create session (reuses same handler as main chat)
          const result = await window.levante.db.sessions.create({
            title,
            model,
            session_type: 'chat',
          });

          if (result.success && result.data) {
            const sessionId = result.data.id;
            set({ currentSessionId: sessionId });

            console.log('Mini-chat session created:', sessionId);
            return sessionId;
          } else {
            console.error('Failed to create mini-chat session:', result.error);
            set({ error: 'Failed to create session' });
            return null;
          }
        } catch (error) {
          console.error('Error creating mini-chat session:', error);
          set({ error: error instanceof Error ? error.message : 'Unknown error' });
          return null;
        }
      },

      // Reset Actions
      reset: () =>
        set({
          inputValue: '',
          error: null,
          currentSessionId: null,  // Clear session on reset
        }),
    }),
    { name: 'mini-chat-store' }
  )
);
