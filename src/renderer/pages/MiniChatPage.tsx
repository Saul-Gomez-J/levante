/**
 * Mini Chat Page
 * 
 * Main page component for the mini-chat floating window.
 * Handles keyboard events and window lifecycle.
 */

import React, { useEffect } from 'react';
import { MiniChatContainer } from '@/components/mini-chat/MiniChatContainer';
import { useMiniChatStore } from '@/stores/miniChatStore';

export function MiniChatPage() {
  const { reset, setIsVisible } = useMiniChatStore();

  useEffect(() => {
    // Listen for window show/hide events from main process
    const handleShown = () => {
      setIsVisible(true);
    };

    const handleHidden = () => {
      setIsVisible(false);
      reset(); // Clear conversation when hidden
    };

    // Subscribe to IPC events
    const unsubscribeShown = window.levante?.onMiniChatShown?.(handleShown);
    const unsubscribeHidden = window.levante?.onMiniChatHidden?.(handleHidden);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        window.levante?.miniChat?.hide?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unsubscribeShown?.();
      unsubscribeHidden?.();
    };
  }, [reset, setIsVisible]);

  return (
    <div className="mini-chat-page">
      <MiniChatContainer />
    </div>
  );
}
