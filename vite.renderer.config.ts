import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { ENV_DEFAULTS } from './src/shared/envDefaults';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // Use Vite's `mode` (guaranteed 'production' on builds) — NOT process.env.NODE_ENV,
  // which may not be set when this config file is evaluated.
  const env = mode === 'production' ? ENV_DEFAULTS.production : ENV_DEFAULTS.development;

  return {
    root: path.resolve(__dirname, 'src/renderer'),
    define: {
      // Levante Platform base URL — baked from ENV_DEFAULTS using Vite's mode
      '__LEVANTE_PLATFORM_URL__': JSON.stringify(env.LEVANTE_PLATFORM_URL),
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
  };
});
