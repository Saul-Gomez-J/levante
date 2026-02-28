import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const PLATFORM_URL_DEFAULT = process.env.NODE_ENV === 'production'
  ? 'https://platform.levanteapp.com'
  : 'http://localhost:3000';

// https://vitejs.dev/config
export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  define: {
    // Levante Platform base URL — override with LEVANTE_PLATFORM_URL env var
    '__LEVANTE_PLATFORM_URL__': JSON.stringify(
      process.env.LEVANTE_PLATFORM_URL || PLATFORM_URL_DEFAULT
    ),
  },
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html')
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
