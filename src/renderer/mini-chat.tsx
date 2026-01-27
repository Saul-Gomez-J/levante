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

ReactDOM.createRoot(document.getElementById('mini-chat-root')!).render(
  <React.StrictMode>
    <MiniChatPage />
  </React.StrictMode>
);
