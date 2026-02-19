import React from 'react';
import { createRoot } from 'react-dom/client';
import '../globals.css';
import { PreviewNavBar } from './pages/PreviewNavBar';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <PreviewNavBar />
    </React.StrictMode>
  );
}
