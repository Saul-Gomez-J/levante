import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        'mini-chat': path.resolve(__dirname, 'src/renderer/mini-chat.html'),
        'preview-nav': path.resolve(__dirname, 'src/renderer/preview/nav.html')
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer')
    }
  },
  plugins: [react()],
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.js')
  }
});
