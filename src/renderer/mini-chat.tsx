/**
 * Mini Chat Entry Point
 *
 * Standalone entry point for the mini-chat floating window.
 * Uses the same design system but simplified for quick interactions.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MiniChatPage } from './pages/MiniChatPage';
import './globals.css';
import './styles/mini-chat.css';

// Detect system dark mode and apply Tailwind's dark class
function applyDarkModeClass() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

// Apply on load
applyDarkModeClass();

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyDarkModeClass);

ReactDOM.createRoot(document.getElementById('mini-chat-root')!).render(
  <React.StrictMode>
    <MiniChatPage />
  </React.StrictMode>
);
